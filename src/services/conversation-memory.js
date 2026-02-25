const conversationHistories = new Map();

function getConversationHistory(workspaceId, contactId) {
  if (!conversationHistories.has(workspaceId)) {
    conversationHistories.set(workspaceId, new Map());
  }
  const wsMap = conversationHistories.get(workspaceId);
  if (!wsMap.has(contactId)) {
    wsMap.set(contactId, []);
  }
  return wsMap.get(contactId);
}

function pushToConversationHistory(workspaceId, contactId, role, content, maxTurns = 10) {
  const history = getConversationHistory(workspaceId, contactId);
  history.push({ role, content, ts: new Date().toISOString() });
  const maxMessages = maxTurns * 2;
  if (history.length > maxMessages) {
    history.splice(0, history.length - maxMessages);
  }
}

function formatHistoryForPrompt(history) {
  if (!history || history.length === 0) return "";
  const lines = history.map((message) => {
    const label = message.role === "user" ? "Customer" : "You (Assistant)";
    return `${label}: ${message.content}`;
  });
  return `CONVERSATION HISTORY (oldest first — use this to avoid repeating yourself and stay contextually relevant):
${lines.join("\n")}
`;
}

function clearConversationHistory(workspaceId, contactId) {
  const wsMap = conversationHistories.get(workspaceId);
  if (wsMap) wsMap.delete(contactId);
}

module.exports = {
  getConversationHistory,
  pushToConversationHistory,
  formatHistoryForPrompt,
  clearConversationHistory,
};
