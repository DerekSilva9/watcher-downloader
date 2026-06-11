chrome.webRequest.onResponseStarted.addListener(
  (details) => {
    const url = details.url.toLowerCase();
    const tabId = details.tabId;
    
    if (tabId < 0) return;

    // 1. FILTRO DE LIXO: Ignora os pedaços (.ts), chat e telemetria do YouTube
    if (url.includes('.ts') || url.includes('youtubei/v1') || url.includes('live_chat') || url.includes('heartbeat')) {
      return; 
    }

    // 2. O QUE IMPORTA: Arquivos de vídeo inteiros ou a playlist HLS mestre (.m3u8)
    const isVideo = url.includes('.mp4') || url.includes('.m3u8') || url.includes('.webm') || details.type === 'media';

    if (isVideo) {
      chrome.storage.local.get(['videos'], (res) => {
        const videos = res.videos || {};
        if (!videos[tabId]) videos[tabId] = [];
        
        // Salva só se for novo pra não encher a lista com a mesma coisa
        if (!videos[tabId].includes(details.url)) {
          videos[tabId].push(details.url);
          chrome.storage.local.set({ videos });
        }
      });
    }
  },
  { urls: ["<all_urls>"] }
);

// Limpa quando a aba fecha
chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.local.get(['videos'], (res) => {
    const videos = res.videos || {};
    delete videos[tabId];
    chrome.storage.local.set({ videos });
  });
});