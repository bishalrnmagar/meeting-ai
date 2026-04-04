// In-memory session store: meetingId -> bot instance
const sessions = new Map();

module.exports = {
  set(meetingId, botInstance) {
    sessions.set(meetingId, botInstance);
  },

  get(meetingId) {
    return sessions.get(meetingId);
  },

  delete(meetingId) {
    sessions.delete(meetingId);
  },

  has(meetingId) {
    return sessions.has(meetingId);
  },

  getAll() {
    return Object.fromEntries(sessions);
  },

  size() {
    return sessions.size;
  },
};
