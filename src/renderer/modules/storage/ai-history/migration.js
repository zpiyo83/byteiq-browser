async function migrateFromLegacy(storage, store) {
  await storage.init();
  const legacySessions = store?.get('ai.sessions', {});
  if (!legacySessions || Object.keys(legacySessions).length === 0) {
    return { migrated: 0 };
  }

  let migrated = 0;
  for (const [sessionId, session] of Object.entries(legacySessions)) {
    try {
      await storage.createSession({
        id: sessionId,
        title: session.title,
        pinned: session.pinned,
        deleted: session.deleted,
        mode: session.mode,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        pageContext: session.pageContext
      });

      if (session.messages && Array.isArray(session.messages)) {
        for (const msg of session.messages) {
          await storage.addMessage(sessionId, {
            role: msg.role,
            content: msg.content,
            createdAt: msg.createdAt || Date.now(),
            metadata: msg.metadata || {}
          });
        }
      }

      migrated++;
    } catch (error) {
      console.error(`Failed to migrate session ${sessionId}:`, error);
    }
  }

  return { migrated };
}

module.exports = {
  migrateFromLegacy
};
