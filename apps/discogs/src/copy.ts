/**
 * Postgres COPY (text format) encoding + a writer that respects backpressure,
 * so a 90 GB dump streams through constant memory.
 */
import type { PoolClient } from "pg";
import { from as copyFrom } from "pg-copy-streams";
import type { Writable } from "node:stream";
import { finished } from "node:stream/promises";

/** A value for a json/jsonb column. Plain JS arrays are encoded as Postgres arrays (text[], int[]). */
export class Json {
  constructor(readonly value: unknown) {}
}
export const json = (value: unknown) => new Json(value);

export type Cell = string | number | boolean | null | undefined | string[] | number[] | Json;

/** Escape for COPY text format: backslash, tab, newline, carriage return. */
function esc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\t/g, "\\t").replace(/\n/g, "\\n").replace(/\r/g, "\\r");
}

/** A Postgres array literal: {"a","b"} with " and \ escaped inside elements. */
function arrayLiteral(values: unknown[]): string {
  return `{${values
    .map((v) => {
      if (typeof v === "number") return String(v);
      if (typeof v === "string") return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
      throw new TypeError(`array cell holds a ${typeof v}; wrap json values in json(...)`);
    })
    .join(",")}}`;
}

export function encodeRow(cells: Cell[]): string {
  return (
    cells
      .map((c) => {
        if (c === null || c === undefined) return "\\N";
        if (typeof c === "boolean") return c ? "t" : "f";
        if (typeof c === "number") return String(c);
        if (typeof c === "string") return esc(c);
        if (c instanceof Json) return esc(JSON.stringify(c.value));
        if (Array.isArray(c)) return esc(arrayLiteral(c));
        throw new TypeError(`unsupported cell: ${typeof c}`);
      })
      .join("\t") + "\n"
  );
}

/** One COPY ... FROM STDIN stream on its own connection. */
export class CopyWriter {
  private stream: Writable;
  private error: Error | null = null;
  private draining: Promise<void> | null = null;
  private released = false;
  rows = 0;

  constructor(
    private readonly client: PoolClient,
    table: string,
    columns: string[],
  ) {
    this.stream = client.query(copyFrom(`COPY ${table} (${columns.join(", ")}) FROM STDIN`));
    // Without a listener a failed COPY crashes the process ("Connection terminated")
    // instead of surfacing as an error from write()/end().
    this.stream.on("error", (err) => {
      this.error ??= err;
    });
  }

  /** Write a row; resolves immediately unless Postgres is behind (then waits for drain). */
  async write(cells: Cell[]): Promise<void> {
    if (this.error) throw this.error;
    const line = encodeRow(cells); // throws before anything is sent if a cell is bad
    this.rows++;
    if (!this.stream.write(line)) {
      // One shared wait per backpressure episode (not one listener per row).
      this.draining ??= new Promise<void>((resolve, reject) => {
        const done = (err?: Error) => {
          this.stream.off("drain", done);
          this.stream.off("error", done);
          this.draining = null;
          err ? reject(err) : resolve();
        };
        this.stream.once("drain", done);
        this.stream.once("error", done);
      });
    }
    if (this.draining) await this.draining;
  }

  async end(): Promise<void> {
    if (this.error) throw this.error;
    this.stream.end();
    await finished(this.stream);
    this.release();
  }

  /** Abort the COPY (rolls back this table's load). */
  abort(err: Error) {
    this.stream.destroy(err);
    this.release(err);
  }

  private release(err?: Error) {
    if (this.released) return;
    this.released = true;
    this.client.release(err);
  }
}
