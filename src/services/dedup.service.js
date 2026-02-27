/* ─── Lead Deduplication Service ────────────────────────────────────────────
 *  Find and merge duplicate leads by phone number.
 * ─────────────────────────────────────────────────────────────────────────── */

const { saveStore } = require("../models/store");

/** Extract base phone number from a lead ID (remove @c.us / @g.us) */
function baseNumber(leadId) {
  return String(leadId || "").replace(/@c\.us$|@g\.us$/i, "").replace(/[^0-9]/g, "");
}

/**
 * Find duplicate leads in a workspace.
 * Duplicates = leads whose base phone number matches.
 */
function findDuplicates(workspace) {
  const leads = Array.isArray(workspace.leads) ? workspace.leads : [];
  const groups = new Map();

  for (const lead of leads) {
    const num = baseNumber(lead.id);
    if (!num) continue;
    if (!groups.has(num)) groups.set(num, []);
    groups.get(num).push(lead);
  }

  const duplicates = [];
  for (const [number, group] of groups) {
    if (group.length > 1) {
      // Sort by score desc, then updatedAt desc — first one is "primary"
      group.sort((a, b) => (b.score || 0) - (a.score || 0) || new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
      duplicates.push({
        number,
        count: group.length,
        primary: group[0],
        duplicates: group.slice(1),
      });
    }
  }
  return duplicates;
}

/**
 * Merge duplicate leads into the primary lead.
 * Keeps the highest score, latest data, and merges notes/tags.
 */
function mergeDuplicates(workspace, primaryId, duplicateIds) {
  const leads = Array.isArray(workspace.leads) ? workspace.leads : [];
  const primary = leads.find(l => l.id === primaryId);
  if (!primary) throw new Error("Primary lead not found.");

  const toMerge = leads.filter(l => duplicateIds.includes(l.id) && l.id !== primaryId);
  if (toMerge.length === 0) throw new Error("No duplicates found to merge.");

  for (const dup of toMerge) {
    // Keep highest score
    if ((dup.score || 0) > (primary.score || 0)) primary.score = dup.score;

    // Keep hottest status
    const statusRank = { cold: 0, warm: 1, hot: 2 };
    if ((statusRank[dup.status] || 0) > (statusRank[primary.status] || 0)) {
      primary.status = dup.status;
    }

    // Keep most advanced stage
    const stageRank = { new: 0, qualified: 1, proposal: 2, booking: 3, closed_won: 4, closed_lost: 5 };
    if ((stageRank[dup.stage] || 0) > (stageRank[primary.stage] || 0)) {
      primary.stage = dup.stage;
    }

    // Merge qualification (keep non-empty)
    if (dup.qualification) {
      for (const field of ["need", "budget", "timeline", "decision_maker"]) {
        if (dup.qualification[field] && !primary.qualification?.[field]) {
          if (!primary.qualification) primary.qualification = {};
          primary.qualification[field] = dup.qualification[field];
        }
      }
    }

    // Merge tags
    if (Array.isArray(dup.tags)) {
      if (!Array.isArray(primary.tags)) primary.tags = [];
      for (const tag of dup.tags) {
        if (!primary.tags.includes(tag)) primary.tags.push(tag);
      }
    }

    // Merge internal notes
    if (Array.isArray(dup.internalNotes)) {
      if (!Array.isArray(primary.internalNotes)) primary.internalNotes = [];
      primary.internalNotes.push(...dup.internalNotes);
    }

    // Merge custom data
    if (dup.customData && typeof dup.customData === "object") {
      if (!primary.customData) primary.customData = {};
      for (const [key, val] of Object.entries(dup.customData)) {
        if (!primary.customData[key]) primary.customData[key] = val;
      }
    }

    // Keep most recent name if primary has generic one
    if (dup.name && (!primary.name || primary.name === primary.id.split("@")[0])) {
      primary.name = dup.name;
    }
  }

  // Remove merged duplicates
  primary.updatedAt = new Date().toISOString();
  workspace.leads = workspace.leads.filter(l => !duplicateIds.includes(l.id) || l.id === primaryId);
  saveStore();

  return { primary, mergedCount: toMerge.length };
}

/**
 * Auto-merge all duplicates in a workspace.
 */
function autoMergeAll(workspace) {
  const groups = findDuplicates(workspace);
  let totalMerged = 0;
  const results = [];

  for (const group of groups) {
    try {
      const dupIds = group.duplicates.map(d => d.id);
      const result = mergeDuplicates(workspace, group.primary.id, dupIds);
      totalMerged += result.mergedCount;
      results.push({ primaryId: group.primary.id, merged: result.mergedCount });
    } catch (err) {
      results.push({ primaryId: group.primary.id, error: err.message });
    }
  }

  return { totalMerged, groups: results };
}

module.exports = {
  findDuplicates,
  mergeDuplicates,
  autoMergeAll,
};
