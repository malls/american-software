// lib/contracts/templates/independent-contractor-agreement.js — the one v1
// template declaration (AS-42, plan §3.1, §3.3; split out of templates.js at
// the plan §8 measured line of ~250 lines, which the combined file passed).
//
// A DECLARATION, NOT A DOCUMENT. This file exports a plain object and imports
// nothing; ../templates.js validates it, freezes it, and registers it. Keeping
// it import-free is what makes it obviously data: there is no code here that
// could reach a database, a clock, or the wire.
//
// PLACEHOLDER BODY TEXT UNDER A LEGAL GATE. Structurally complete, legally
// inert, and marked THREE independent ways so losing one marker does not
// silently unmark it: the title ends "(placeholder)", the notice renders as its
// own section INSIDE the document (so it survives print and download), and the
// body carries three [PLACEHOLDER — ...] labels. Replacing this text is a NEW
// declaration at `...@2`, never an edit here — see ../templates.js on why the
// version rides in the id.
//
// WHY THE ATTRIBUTION DOES NOT NAME COMMON PAPER (plan §3.3, §9 Q2). The
// wireframe renders "adapted from a template by Common Paper, licensed under
// CC BY 4.0". That statement is FALSE of this artefact: the body below is our
// own placeholder text, derived from nothing. Attributing it to Common Paper
// would misattribute authorship — the error CC BY's attribution clause exists
// to prevent, pointed the other way — and would make the document look MORE
// authoritative than it is, working against the very gate the placeholder
// exists to hold open. So the line states the mechanism truthfully and names
// what will occupy the slot. At M4 the new declaration sets `sourceTemplate`
// and ../templates.js's cross-check forces the licence into the line.
//
// This is a CTO call inside a gate the CEO and CTO own jointly; overturning it
// is a one-string change plus a bumped version and a new digest.

/** @type {object} validated and frozen by ../templates.js at module load. */
export const INDEPENDENT_CONTRACTOR_AGREEMENT_V1 = {
  id: 'independent-contractor-agreement@1',
  title: 'Independent Contractor Agreement (placeholder)',
  sourceTemplate: null, // { name, licence, url } once real adapted text lands
  attribution:
    'Attribution: this body is placeholder text and is not adapted from any '
    + 'third-party source. When adapted template text (Common Paper, CC BY 4.0) '
    + 'replaces it, that attribution appears here.',
  notice: {
    title: 'Placeholder contract text — not legal advice',
    paragraphs: [
      "This document's body is placeholder text. It is not legal advice and should "
      + 'not be relied upon until this notice is removed.',
      'Pending a lawyer-agent review of the adapted source template. This warning is '
      + 'part of the document itself and survives print and download.',
    ],
  },
  variables: [
    { name: 'freelancerName', source: 'record', type: 'text', label: 'Your name' },
    { name: 'clientName', source: 'record', type: 'text', label: 'Client' },
    { name: 'projectDescription', source: 'form', type: 'multiline', label: 'Project description', required: true, maxLength: 5000 },
    { name: 'startDate', source: 'form', type: 'date', label: 'Start date', required: true },
  ],
  body: [
    [{ text: 'This agreement is between ' }, { slot: 'freelancerName', strong: true },
      { text: ' ("Provider") and ' }, { slot: 'clientName', strong: true },
      { text: ' ("Client"), effective ' }, { slot: 'startDate', strong: true },
      { text: '.' }],
    [{ text: '[PLACEHOLDER — scope of work]: ', strong: true }, { slot: 'projectDescription' }],
    [{ text: '[PLACEHOLDER — payment terms]: ', strong: true },
      { text: 'Placeholder text pending legal review. Do not rely on this section.' }],
    [{ text: '[PLACEHOLDER — standard terms]: ', strong: true },
      { text: 'Placeholder text pending legal review. Do not rely on this section.' }],
  ],
};
