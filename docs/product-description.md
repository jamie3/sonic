# Sonic — Vinyl Collection Cataloging System

**Status:** Draft · Product description (pre-architecture)
**Last updated:** 2026-06-09

---

## 1. Overview

Sonic is a personal vinyl cataloging system. You photograph a record with a
mobile app, the photos are uploaded to cloud storage, and the system
automatically identifies the record and adds a rich, structured entry to your
collection library. The goal is to turn the slow, manual work of cataloging
vinyl into a few seconds of pointing a phone camera at a sleeve.

The end state is a searchable, browsable digital index of a physical record
collection — what you own, where it came from, what condition it's in, and how
to find it on a shelf.

## 2. Problem & Motivation

Cataloging vinyl by hand is tedious. Each record means looking up the artist,
title, label, catalog number, pressing year, and country, then typing it all in.
Doing this for a collection of hundreds of records is enough friction that most
collections never get cataloged at all.

Existing tools (Discogs app, spreadsheets) require manual lookup and data entry.
Sonic's premise is that a photo of the sleeve and label contains nearly all the
information needed — so the human just takes the picture, and software does the
identification and data entry.

## 3. Target User

A single primary user to start (the owner), with the system designed so it could
later support multiple users / shared collections.

**Persona:** A DJ and record collector who buys physical vinyl, already uses
Discogs for metadata, and wants a low-friction way to keep a digital inventory of
the physical collection — for insurance, for knowing what they own before buying
duplicates, and for finding a record on the shelf quickly.

## 4. Core Concepts (Domain Model — informal)

- **Capture** — one photo session for a single record. May include multiple
  photos (front cover, back cover, label/A-side, label/B-side, spine).
- **Record (Release)** — the identified release: artist, title, label, catalog
  number, format, pressing year, country, tracklist. This maps closely to a
  Discogs *release*.
- **Catalog Entry (Copy)** — *your specific copy* of a release: condition,
  purchase price/date, storage location, personal notes, and the captured
  photos. One release can in principle have multiple copies.
- **Library** — the full collection of catalog entries, searchable and
  browsable.

The distinction between a *release* (shared, factual metadata) and a *copy*
(your personal, per-item data) is the key modeling decision and should carry
through to the architecture.

## 5. Core User Journeys

### 5.1 Catalog a new record (primary flow)
1. Open the app, tap "Add Record."
2. Take photos: front cover, then optionally back cover and labels.
3. Photos upload to cloud storage in the background.
4. The system attempts to identify the record against external metadata sources
   (see §6). There are three possible outcomes:
   - **Single match** — exactly one release matched. The record is presented
     with that proposed match.
   - **Multiple matches** — more than one plausible release matched. **The owner
     is asked to choose** which one (or to reject them all and search/enter
     manually).
   - **No match** — nothing matched. **The owner is asked how to proceed** —
     search a metadata source manually, enter metadata by hand, or skip.
5. The record lands in a **Pending Approval** state in all three cases. Nothing
   enters the catalog automatically.
6. The owner resolves and approves pending records:
   - **Single match** → confirm/approve the proposed match.
   - **Multiple matches** → pick the correct release, then approve.
   - **No match** → resolve via manual search or hand entry, then approve.
7. On approval, the owner can add copy-specific details (condition, location,
   price). The catalog entry is saved to the library.

### 5.1a Bulk approval
When cataloging many records in a session, the Pending Approval queue supports
**bulk selection and approval**:
- Select multiple pending records (e.g. select-all, or multi-select).
- Bulk-approve in one action. Only records that are unambiguous (**single
  match**) are eligible for bulk approval.
- **Multiple-match** and **no-match** records are excluded from bulk approval —
  they still require an individual decision — but the UI should make it easy to
  approve all the clean ones and leave the ambiguous ones for follow-up.

### 5.2 Browse & search the library
- Browse the collection as a grid of cover art.
- Search/filter by artist, label, genre, year, location, condition.
- Open a record to see full metadata, photos, and personal notes.

### 5.3 Recognition fallback
- When automatic identification is uncertain or wrong, the user can search a
  metadata source (e.g. Discogs) manually and attach the correct release, or
  enter metadata by hand. Nothing should ever be a dead end.

## 6. Recognition / "Scanning" — How Identification Works

This is the heart of the product. "Scan the picture and catalog it" breaks into
a pipeline of strategies whose results are resolved against **external metadata
sources** and combined into a single confidence score.

### 6.1 Extraction strategies (signals from the photos)
1. **Barcode** — many modern pressings have a barcode; a barcode lookup is the
   fastest, most reliable signal when present.
2. **Catalog number + label OCR** — extract printed text (catalog number, label
   name) from the label/back cover.
3. **Vision metadata extraction** — use a multimodal model to read the cover and
   label photos and extract artist, title, label, and catalog number as
   structured fields.

### 6.2 External metadata sources (the source of truth)
Extracted signals are resolved against external APIs, which provide the
canonical release data (tracklist, year, country, genre, cover art):
- **Discogs** — primary source, given existing usage; richest vinyl/pressing
  coverage.
- **MusicBrainz** — secondary/fallback source for cross-checking and filling
  gaps.
- The design should treat metadata sources behind a common interface so others
  can be added later.

### 6.3 Identification result
The pipeline does **not** produce a numeric score. Instead each capture resolves
the extracted signals against the external sources into one of three outcomes,
based on how many releases match:

- **Single match** — exactly one release matched. Presented as the proposed
  match for the owner to confirm.
- **Multiple matches** — more than one plausible release matched (common for
  vinyl, where the same release has many pressings/variants). The owner is asked
  to disambiguate. The system never silently picks one.
- **No match** — nothing usable was returned (no barcode/catalog hit, OCR/vision
  too weak, or the sources returned nothing). The owner is asked how to proceed.

There is **no auto-cataloging**. Every record lands in a **Pending Approval**
state, and the owner is the final gate on what enters the catalog:

- Confirm a single match.
- Choose among multiple matches.
- Resolve a no-match via manual search or hand entry — or skip the record.

This keeps the human as the authority on catalog quality, with identification
acting as a strong head-start rather than a decision-maker. The two ambiguous
outcomes — *multiple matches* and *no match* — always require an explicit owner
decision before anything is approved.

## 7. Features

### MVP
- React Native mobile app (camera capture of one+ photos per record).
- Background upload of photos to cloud object storage (bucket).
- Recognition pipeline resolving against external metadata sources (Discogs
  primary, MusicBrainz fallback), returning single match, multiple matches, or
  no match.
- Pending Approval queue — owner approves every record into the catalog.
- Bulk selection and approval for single-match records.
- Disambiguation prompt for multiple matches; manual search + manual entry
  fallback for no match.
- Persisted library with structured release + copy data.
- Browse (cover grid) and search/filter.
- Single-user.

### Post-MVP / Future
- Storage location / shelf mapping ("where is this record?").
- Condition grading assistance from photos.
- Duplicate detection ("you already own this").
- Value tracking (estimated market value via Discogs price data).
- Export (CSV / Discogs sync).
- Multi-user / shared collections.
- Wishlist and "scan before you buy" duplicate check in a record shop.
- Audio/DJ tie-in: link to digital versions, BPM/key metadata.

## 8. Non-Functional Requirements & Constraints

- **TypeScript-first** across mobile and backend.
- **Mobile-first**, but library may later have a web view for browsing/admin.
- **Offline tolerance** — captures should queue and upload when connectivity
  returns; cataloging should not block on network.
- **Cost-conscious** — personal project; prefer managed/free-tier services and
  pay-per-use over always-on infrastructure where reasonable.
- **Privacy** — single owner's data; storage should not be world-readable by
  default.
- **Recognition accuracy over speed** — a few seconds of processing is fine if
  the match is good.

## 9. Out of Scope (for now)

- Selling/marketplace features.
- Social features / public collection sharing.
- Full audio fingerprinting of the actual record audio.
- Inventory for non-vinyl formats (CDs, tapes) — possible later, not now.

## 10. Decisions & Open Questions

### Decided
- **Metadata sources** — external APIs are the source of truth: **Discogs**
  primary, **MusicBrainz** as fallback/cross-check, behind a common interface.
- **Single-user** for v1.
- **No auto-cataloging / no scoring** — identification is binary (identified vs.
  unidentifiable); every record waits in **Pending Approval** until the owner
  approves it into the catalog.

### Still open (resolve before / during architecture)
1. **Recognition engine** — which multimodal/vision model and how is it hosted
   (cloud API vs. self-hosted on the Mac mini server)? What does barcode/OCR use?
2. **Hosting model** — fully cloud (e.g. Vercel + managed storage/DB) vs.
   leveraging the existing Mac mini home server (Tailscale/launchd)?
3. **Storage** — which bucket/object store, and which database for the catalog?
4. **Processing trigger** — synchronous on upload vs. async job/queue after the
   bucket write?
5. **Match criteria** — what counts as a candidate match worth surfacing, and
   how the pipeline decides between "single match" and "multiple matches" (e.g.
   how close two pressings must be before both are shown for disambiguation)?
6. **Discogs/MusicBrainz limits** — rate limits and auth model for each, and how
   that constrains throughput when bulk-cataloging.

---

*Next step: use this document to produce a system architecture and design — data
model, services, recognition pipeline, and hosting choices.*
