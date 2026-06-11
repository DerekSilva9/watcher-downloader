// Armazena vídeos com mais informações
let detectedVideos = new Map();

function getVideoKey(url, tabId) {
    const cleanUrl = url.split('?')[0].split('#')[0];
    return `${tabId}:${cleanUrl}`;
}

function isRealVideoUrl(url) {
    const cleanUrl = url.split('?')[0];
    const videoExtensions = /\.(mp4|webm|mkv|mov|avi|m3u8|mpd|ts)$/i;
    if (videoExtensions.test(cleanUrl)) return true;
    
    const streamingPatterns = /\/hls\//i.test(url) || /\/dash\//i.test(url) || /videoplayback/i.test(url);
    if (streamingPatterns) return true;
    
    return false;
}

// Detector de vídeos
chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
        const url = details.url;
        const tabId = details.tabId;
        
        if (tabId < 0) return;
        if (!isRealVideoUrl(url)) return;
        
        const irrelevantTypes = ['image', 'stylesheet', 'script', 'font', 'ping'];
        if (irrelevantTypes.includes(details.type)) return;
        
        const videoKey = getVideoKey(url, tabId);
        
        if (!detectedVideos.has(videoKey)) {
            // Detecta se é HLS (m3u8) ou direto (mp4)
            const isHLS = url.includes('.m3u8') || url.includes('.mpd');
            const isDirect = !isHLS && (url.includes('.mp4') || url.includes('.webm'));
            
            detectedVideos.set(videoKey, {
                url: url,
                cleanUrl: url.split('?')[0],
                tabId: tabId,
                timestamp: Date.now(),
                type: isDirect ? 'direct' : 'hls',
                isHLS: isHLS,
                quality: extractQualityFromUrl(url)
            });
            
            console.log(`[Background] Detectado: ${isDirect ? 'DIRECT' : 'HLS'}`);
            updateStoredVideos();
        }
    },
    { urls: ["<all_urls>"] }
);

// Extrai qualidade da URL (ex: 240P, 720P)
function extractQualityFromUrl(url) {
    const match = url.match(/(\d+)[Pp]/);
    if (match) return match[1] + 'p';
    
    if (url.includes('240')) return '240p';
    if (url.includes('480')) return '480p';
    if (url.includes('720')) return '720p';
    if (url.includes('1080')) return '1080p';
    
    return 'Unknown';
}

function updateStoredVideos() {
    const byTab = {};
    for (const [key, info] of detectedVideos.entries()) {
        if (!byTab[info.tabId]) byTab[info.tabId] = [];
        byTab[info.tabId].push(info);
    }
    chrome.storage.local.set({ videos: byTab });
    
    const total = detectedVideos.size;
    chrome.action.setBadgeText({ text: total > 0 ? total.toString() : "" });
}

// Limpa vídeos antigos
setInterval(() => {
    const now = Date.now();
    let changed = false;
    for (const [key, info] of detectedVideos.entries()) {
        if (now - info.timestamp > 300000) {
            detectedVideos.delete(key);
            changed = true;
        }
    }
    if (changed) updateStoredVideos();
}, 60000);

// Limpa ao navegar
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'loading') {
        let changed = false;
        for (const [key, info] of detectedVideos.entries()) {
            if (info.tabId === tabId) {
                detectedVideos.delete(key);
                changed = true;
            }
        }
        if (changed) updateStoredVideos();
    }
});

// Nova função: Busca qualidades disponíveis no HLS
async function getAvailableQualities(hlsUrl) {
    try {
        const response = await fetch(hlsUrl);
        const text = await response.text();
        
        // Procura por playlists de qualidade no formato:
        // #EXT-X-STREAM-INF:BANDWIDTH=... RESOLUTION=640x360
        // playlist_360p.m3u8
        
        const qualities = [];
        const lines = text.split('\n');
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.includes('#EXT-X-STREAM-INF')) {
                // Extrai resolução se disponível
                const resolutionMatch = line.match(/RESOLUTION=(\d+x\d+)/);
                const bandwidthMatch = line.match(/BANDWIDTH=(\d+)/);
                
                // Próxima linha é a URL da playlist daquela qualidade
                const qualityUrl = lines[i + 1];
                if (qualityUrl && !qualityUrl.startsWith('#')) {
                    let qualityName = 'Unknown';
                    
                    if (resolutionMatch) {
                        const height = resolutionMatch[1].split('x')[1];
                        qualityName = height + 'p';
                    } else if (bandwidthMatch) {
                        const bw = parseInt(bandwidthMatch[1]);
                        if (bw < 500000) qualityName = '240p';
                        else if (bw < 1000000) qualityName = '480p';
                        else if (bw < 2500000) qualityName = '720p';
                        else qualityName = '1080p+';
                    }
                    
                    const fullUrl = new URL(qualityUrl, hlsUrl).href;
                    qualities.push({
                        name: qualityName,
                        url: fullUrl,
                        resolution: resolutionMatch ? resolutionMatch[1] : null
                    });
                }
            }
        }
        
        return qualities;
    } catch (err) {
        console.error('[Background] Erro ao buscar qualidades:', err);
        return [];
    }
}

// Mensagens do popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'getVideos') {
        const tabId = message.tabId;
        const videos = [];
        
        for (const [key, info] of detectedVideos.entries()) {
            if (info.tabId === tabId) {
                videos.push(info);
            }
        }
        
        sendResponse({ videos: videos });
    }
    else if (message.action === 'clearTabVideos') {
        const tabId = message.tabId;
        let changed = false;
        
        for (const [key, info] of detectedVideos.entries()) {
            if (info.tabId === tabId) {
                detectedVideos.delete(key);
                changed = true;
            }
        }
        
        if (changed) updateStoredVideos();
        sendResponse({ success: true });
    }
    else if (message.action === 'getQualities') {
        // Popup pede as qualidades disponíveis para um HLS
        getAvailableQualities(message.url).then(qualities => {
            sendResponse({ qualities: qualities });
        });
        return true; // Resposta assíncrona
    }
    else if (message.action === 'start_download') {
        chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' });
        chrome.action.setBadgeText({ text: "0%" });
        
        chrome.offscreen.closeDocument().catch(() => {});
        chrome.offscreen.createDocument({
            url: `offscreen.html?url=${encodeURIComponent(message.url)}&title=${encodeURIComponent(message.title)}&isHLS=${message.isHLS}`,
            reasons: ['DOM_SCRAPING'],
            justification: 'Download de vídeo'
        });
        sendResponse({ success: true });
    }
    else if (message.action === 'update_progress') {
        chrome.action.setBadgeText({ text: message.pct });
    }
    else if (message.action === 'finish_download') {
        chrome.action.setBadgeText({ text: "" });
        chrome.offscreen.closeDocument().catch(() => {});
    }
    
    return true;
});

console.log('[Background] Carregado com suporte a qualidades');