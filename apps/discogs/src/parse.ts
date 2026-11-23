/**
 * Streaming parsers for the Discogs dumps. Each turns the SAX event stream into
 * one plain record per top-level element (<release>, <master>, …), keeping only
 * the fields the local copy stores. Paths are relative to that element, so
 * nested lookalikes (track credits, extraartists, sub-tracks) are ignored.
 */
import { SaxesParser } from "saxes";

export interface ArtistRef {
  id: number | null;
  name: string;
  anv: string | null; // artist name variation as credited on this release
  join: string | null;
}

export interface ReleaseRecord {
  id: number;
  title: string;
  artists: ArtistRef[];
  labels: { id: number | null; name: string; catno: string | null }[];
  formats: { name: string; qty: string | null; text: string | null; descriptions: string[] }[];
  genres: string[];
  styles: string[];
  country: string | null;
  released: string | null;
  masterId: number | null;
  isMain: boolean;
  identifiers: { type: string; value: string; description: string | null }[];
  tracks: { position: string | null; title: string; duration: string | null }[];
  dataQuality: string | null;
}

export interface MasterRecord {
  id: number;
  mainRelease: number | null;
  title: string;
  artists: ArtistRef[];
  year: number | null;
  genres: string[];
  styles: string[];
  videos: { src: string; title: string | null; duration: number | null }[];
  dataQuality: string | null;
}

export interface ArtistRecord {
  id: number;
  name: string;
  realname: string | null;
  nameVariations: string[];
  dataQuality: string | null;
}

export interface LabelRecord {
  id: number;
  name: string;
  parentName: string | null;
  dataQuality: string | null;
}

type Attrs = Record<string, string>;
const num = (s: string | undefined | null) => {
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const clean = (s: string) => s.trim() || null;

/**
 * Generic driver: tracks the element path below the record element and hands
 * open/close/text events to a per-entity handler.
 */
function makeParser<R>(
  recordTag: string,
  handler: {
    begin(attrs: Attrs): R;
    open?(rec: R, path: string, attrs: Attrs): void;
    close(rec: R, path: string, text: string): void;
  },
  onRecord: (r: R) => void,
): SaxesParser {
  const parser = new SaxesParser();
  let rec: R | null = null;
  const stack: string[] = [];
  let text = "";
  parser.on("opentag", (node) => {
    text = "";
    const attrs = node.attributes as Attrs;
    if (rec === null) {
      if (node.name === recordTag) rec = handler.begin(attrs);
      return;
    }
    stack.push(node.name);
    handler.open?.(rec, stack.join("/"), attrs);
  });
  parser.on("text", (t) => {
    if (rec !== null) text += t;
  });
  parser.on("closetag", (node) => {
    if (rec === null) return;
    if (stack.length === 0 && node.name === recordTag) {
      onRecord(rec);
      rec = null;
      return;
    }
    handler.close(rec, stack.join("/"), text);
    stack.pop();
    text = "";
  });
  return parser;
}

// Shared handling for <artists><artist>…</artist></artists> directly under the record.
function openArtist(artists: ArtistRef[], path: string) {
  if (path === "artists/artist") artists.push({ id: null, name: "", anv: null, join: null });
}
function closeArtist(artists: ArtistRef[], path: string, text: string) {
  const a = artists[artists.length - 1];
  if (!a) return;
  if (path === "artists/artist/id") a.id = num(text.trim());
  else if (path === "artists/artist/name") a.name = text.trim();
  else if (path === "artists/artist/anv") a.anv = clean(text);
  else if (path === "artists/artist/join") a.join = clean(text);
}

export function releaseParser(onRecord: (r: ReleaseRecord) => void) {
  return makeParser<ReleaseRecord>(
    "release",
    {
      begin: (a) => ({
        id: Number(a.id),
        title: "",
        artists: [],
        labels: [],
        formats: [],
        genres: [],
        styles: [],
        country: null,
        released: null,
        masterId: null,
        isMain: false,
        identifiers: [],
        tracks: [],
        dataQuality: null,
      }),
      open(r, path, a) {
        openArtist(r.artists, path);
        if (path === "labels/label") r.labels.push({ id: num(a.id), name: a.name ?? "", catno: a.catno?.trim() || null });
        else if (path === "formats/format")
          r.formats.push({ name: a.name ?? "", qty: a.qty ?? null, text: a.text?.trim() || null, descriptions: [] });
        else if (path === "identifiers/identifier")
          r.identifiers.push({ type: a.type ?? "", value: a.value ?? "", description: a.description ?? null });
        else if (path === "master_id") r.isMain = a.is_main_release === "true";
        else if (path === "tracklist/track") r.tracks.push({ position: null, title: "", duration: null });
      },
      close(r, path, text) {
        closeArtist(r.artists, path, text);
        switch (path) {
          case "title":
            r.title = text.trim();
            break;
          case "genres/genre":
            r.genres.push(text.trim());
            break;
          case "styles/style":
            r.styles.push(text.trim());
            break;
          case "country":
            r.country = clean(text);
            break;
          case "released":
            r.released = clean(text);
            break;
          case "master_id":
            r.masterId = num(text.trim());
            break;
          case "data_quality":
            r.dataQuality = clean(text);
            break;
          case "formats/format/descriptions/description":
            r.formats[r.formats.length - 1]?.descriptions.push(text.trim());
            break;
          case "tracklist/track/position": {
            const t = r.tracks[r.tracks.length - 1];
            if (t) t.position = clean(text);
            break;
          }
          case "tracklist/track/title": {
            const t = r.tracks[r.tracks.length - 1];
            if (t) t.title = text.trim();
            break;
          }
          case "tracklist/track/duration": {
            const t = r.tracks[r.tracks.length - 1];
            if (t) t.duration = clean(text);
            break;
          }
        }
      },
    },
    onRecord,
  );
}

export function masterParser(onRecord: (r: MasterRecord) => void) {
  return makeParser<MasterRecord>(
    "master",
    {
      begin: (a) => ({
        id: Number(a.id),
        mainRelease: null,
        title: "",
        artists: [],
        year: null,
        genres: [],
        styles: [],
        videos: [],
        dataQuality: null,
      }),
      open(r, path, a) {
        openArtist(r.artists, path);
        if (path === "videos/video") r.videos.push({ src: a.src ?? "", title: null, duration: num(a.duration) });
      },
      close(r, path, text) {
        closeArtist(r.artists, path, text);
        switch (path) {
          case "main_release":
            r.mainRelease = num(text.trim());
            break;
          case "title":
            r.title = text.trim();
            break;
          case "year":
            r.year = num(text.trim()) || null;
            break;
          case "genres/genre":
            r.genres.push(text.trim());
            break;
          case "styles/style":
            r.styles.push(text.trim());
            break;
          case "data_quality":
            r.dataQuality = clean(text);
            break;
          case "videos/video/title": {
            const v = r.videos[r.videos.length - 1];
            if (v) v.title = clean(text);
            break;
          }
        }
      },
    },
    onRecord,
  );
}

export function artistParser(onRecord: (r: ArtistRecord) => void) {
  return makeParser<ArtistRecord>(
    "artist",
    {
      begin: () => ({ id: 0, name: "", realname: null, nameVariations: [], dataQuality: null }),
      close(r, path, text) {
        if (path === "id") r.id = Number(text.trim());
        else if (path === "name") r.name = text.trim();
        else if (path === "realname") r.realname = clean(text);
        else if (path === "namevariations/name") r.nameVariations.push(text.trim());
        else if (path === "data_quality") r.dataQuality = clean(text);
      },
    },
    onRecord,
  );
}

export function labelParser(onRecord: (r: LabelRecord) => void) {
  return makeParser<LabelRecord>(
    "label",
    {
      begin: () => ({ id: 0, name: "", parentName: null, dataQuality: null }),
      close(r, path, text) {
        if (path === "id") r.id = Number(text.trim());
        else if (path === "name") r.name = text.trim();
        else if (path === "parentLabel") r.parentName = clean(text);
        else if (path === "data_quality") r.dataQuality = clean(text);
      },
    },
    onRecord,
  );
}

/** "Pink Floyd (2)" → "Pink Floyd": Discogs' disambiguation suffix. */
export function stripDisambiguation(name: string): string {
  return name.replace(/\s+\(\d+\)$/, "");
}

/** Display string for a credit list, honouring Discogs join words ("&", "Feat.", ","). */
export function artistDisplay(artists: ArtistRef[]): string {
  return artists
    .map((a, i) => {
      const name = stripDisambiguation(a.anv || a.name);
      if (i === artists.length - 1 || !a.join) return name;
      return a.join === "," ? `${name}, ` : `${name} ${a.join} `;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

/** "1999-03-00" → 1999. */
export function yearOf(released: string | null): number | null {
  const m = released?.match(/^(\d{4})/);
  const y = m ? Number(m[1]) : null;
  return y && y > 0 ? y : null;
}
