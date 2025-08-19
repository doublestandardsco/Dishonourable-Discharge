// public/api.js
const API = {
  async initGame({ gameId, maxPlayers, finalNightAt }) {
    const r = await fetch(`/api/game/init`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gameId, maxPlayers, finalNightAt })
    });
    return r.json();
  },
  async join(gameId, realName) {
    const r = await fetch(`/api/game/${encodeURIComponent(gameId)}/join`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ realName })
    });
    return r.json();
  },
  async state(gameId, playerId) {
    const url = `/api/game/${encodeURIComponent(gameId)}/state` + (playerId ? `?playerId=${encodeURIComponent(playerId)}` : "");
    const r = await fetch(url, { cache: "no-store" });
    return r.json();
  },
  async patchPlayer(gameId, playerId, patch) {
    const r = await fetch(`/api/game/${encodeURIComponent(gameId)}/player`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId, patch })
    });
    return r.json();
  },
  async action(gameId, payload) {
    const r = await fetch(`/api/game/${encodeURIComponent(gameId)}/action`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    return r.json();
  }
};
window.GameAPI = API;
