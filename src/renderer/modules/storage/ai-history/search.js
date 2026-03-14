const { STORES } = require('./schema');

async function searchMessages(storage, query, options = {}) {
  await storage.init();
  const { limit = 50, sessionId = null } = options;
  const searchText = query.toLowerCase();

  return new Promise((resolve, reject) => {
    const tx = storage.getTransaction([STORES.searchIndex, STORES.messages]);
    const searchStore = tx.objectStore(STORES.searchIndex);

    const results = [];
    let count = 0;

    const request = searchStore.openCursor();

    request.onsuccess = async event => {
      const cursor = event.target.result;
      if (!cursor || count >= limit) {
        resolve(results);
        return;
      }

      const index = cursor.value;

      if (sessionId && index.sessionId !== sessionId) {
        cursor.continue();
        return;
      }

      if (index.text.includes(searchText)) {
        const msgStore = tx.objectStore(STORES.messages);
        const msgRequest = msgStore.get(index.messageId);

        await new Promise(resolveMsg => {
          msgRequest.onsuccess = () => {
            if (msgRequest.result) {
              results.push({
                message: msgRequest.result,
                matchedText: index.text
              });
              count++;
            }
            resolveMsg();
          };
          msgRequest.onerror = () => resolveMsg();
        });
      }

      cursor.continue();
    };

    request.onerror = () => reject(request.error);
  });
}

module.exports = {
  searchMessages
};
