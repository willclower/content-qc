#!/usr/bin/env node
/* Build reference-library/index.json from every <doc_id>/meta.json.
 * - Computes content_hash from source.txt (authoritative), writes it back into meta.json.
 * - Emits claim_domains routing table (domain -> governing doc_ids).
 * - Enforces: exactly one status=governing doc per claim-domain; doc_id == folder name; source.txt present.
 * Usage: node build-index.js [reference-library-dir]
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const LIB = process.argv[2] || "reference-library";

function sha256(file) {
  return "sha256:" + crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

const docs = [];
const errors = [];
const domainOwners = {}; // claim_domain -> [doc_id] (status governing)
const topics = new Set();

for (const folder of fs.readdirSync(LIB).sort()) {
  const dir = path.join(LIB, folder);
  const metaPath = path.join(dir, "meta.json");
  if (!fs.statSync(dir).isDirectory() || !fs.existsSync(metaPath)) continue;

  const m = JSON.parse(fs.readFileSync(metaPath, "utf8"));
  if (m.doc_id !== folder) errors.push(`${folder}: doc_id '${m.doc_id}' != folder name`);

  const txt = path.join(dir, "source.txt");
  const pdf = path.join(dir, "source.pdf");
  const hasTxt = fs.existsSync(txt), hasPdf = fs.existsSync(pdf);

  if (hasTxt) {
    const h = sha256(txt);
    if (m.content_hash !== h) {                 // write hash back into meta.json
      m.content_hash = h;
      fs.writeFileSync(metaPath, JSON.stringify(m, null, 2));
    }
  } else {
    errors.push(`${folder}: source.txt missing (QC pass reads this)`);
  }

  (m.topics || []).forEach(t => topics.add(t));
  if (m.status === "governing")
    (m.governing_for || []).forEach(d => (domainOwners[d] ||= []).push(m.doc_id));

  docs.push({
    doc_id: m.doc_id, title: m.title, issuer: m.issuer, version: m.version,
    status: m.status, topics: m.topics || [], governing_for: m.governing_for || [],
    sections: m.sections || [], content_hash: m.content_hash,
    source_url: m.source_url, retrieved_at: m.retrieved_at,
    paths: { text: hasTxt ? `${folder}/source.txt` : null, pdf: hasPdf ? `${folder}/source.pdf` : null },
  });
}

for (const [d, owners] of Object.entries(domainOwners))
  if (owners.length > 1) errors.push(`claim-domain '${d}' has >1 governing doc: [${owners}] (pick one)`);

if (errors.length) {
  console.error("BUILD FAILED:");
  errors.forEach(e => console.error("  - " + e));
  process.exit(1);
}

const index = {
  generated_at: new Date().toISOString(),
  doc_count: docs.length,
  claim_domains: Object.fromEntries(Object.entries(domainOwners).sort()),
  topics: [...topics].sort(),
  docs: docs.sort((a, b) => a.doc_id.localeCompare(b.doc_id)),
};
fs.writeFileSync(path.join(LIB, "index.json"), JSON.stringify(index, null, 2));
console.log(`OK: ${docs.length} docs, ${Object.keys(domainOwners).length} claim-domains, ${topics.size} topics -> index.json`);
