document.addEventListener('DOMContentLoaded', () => {
    const videoList = document.getElementById('videoList');
    const btnReload = document.getElementById('forceReload');
    const btnClear = document.getElementById('clearVideos');
    const totalCount = document.getElementById('totalCount');
    
    let currentTabId = null;
    let pendingQualityChoice = null; // Guarda info enquanto escolhe qualidade
    
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
        currentTabId = tabs[0].id;
        
        let pageTitle = 'video';
        try {
            const [results] = await chrome.scripting.executeScript({
                target: { tabId: currentTabId },
                func: () => document.querySelector('meta[property="og:title"]')?.content || document.title || 'video'
            });
            if (results?.result) pageTitle = results.result;
        } catch (e) {}
        
        loadVideos(currentTabId, pageTitle);
    });
    
    async function loadVideos(tabId, pageTitle) {
        chrome.runtime.sendMessage({ action: 'getVideos', tabId: tabId }, (response) => {
            const videos = response?.videos || [];
            
            if (totalCount) totalCount.textContent = videos.length;
            
            if (videos.length === 0) {
                videoList.innerHTML = `<div class="empty-state"><span>🎬</span><p>Nenhum vídeo detectado</p><small>Dê play no vídeo</small></div>`;
                return;
            }
            
            videoList.innerHTML = '';
            const cleanTitle = pageTitle.replace(/[\\/:*?"<>|]/g, '_').substring(0, 50);
            
            videos.forEach((video, index) => {
                const isHLS = video.isHLS;
                const isDirect = video.type === 'direct';
                
                const div = document.createElement('div');
                div.className = 'video-item';
                
                // Mostra qualidade se disponível
                const qualityInfo = video.quality && video.quality !== 'Unknown' ? ` (${video.quality})` : '';
                
                div.innerHTML = `
                    <div class="video-info">
                        <span class="video-type ${isHLS ? 'hls' : 'direct'}">${isHLS ? '📡 HLS' : '📹 Direct'}</span>
                        <span class="video-filename">${cleanTitle}${qualityInfo}.mp4</span>
                    </div>
                    <div class="video-url">${truncateUrl(video.cleanUrl, 60)}</div>
                    <button class="download-btn" data-url="${escapeHtml(video.url)}" data-type="${isHLS ? 'hls' : 'direct'}" data-filename="${escapeHtml(cleanTitle)}">
                        ${isHLS ? '🎬 Escolher Qualidade' : '⬇️ Baixar Direct'}
                    </button>
                `;
                
                const btn = div.querySelector('.download-btn');
                btn.addEventListener('click', async () => {
                    const url = btn.dataset.url;
                    const type = btn.dataset.type;
                    const filename = btn.dataset.filename;
                    
                    if (type === 'hls') {
                        // Busca qualidades disponíveis
                        btn.textContent = '⏳ Buscando qualidades...';
                        btn.disabled = true;
                        
                        chrome.runtime.sendMessage({ action: 'getQualities', url: url }, (response) => {
                            const qualities = response?.qualities || [];
                            
                            if (qualities.length === 0) {
                                // Se não achou qualidades, baixa direto
                                startDownload(url, filename, true);
                                return;
                            }
                            
                            // Mostra modal com opções de qualidade
                            showQualityModal(qualities, url, filename);
                            btn.disabled = false;
                            btn.textContent = '🎬 Escolher Qualidade';
                        });
                    } else {
                        // Direct: baixa direto
                        startDownload(url, filename, false);
                    }
                });
                
                videoList.appendChild(div);
            });
        });
    }
    
    function startDownload(url, filename, isHLS) {
        chrome.runtime.sendMessage({
            action: 'start_download',
            url: url,
            title: filename,
            isHLS: isHLS
        });
        setTimeout(() => window.close(), 500);
    }
    
    function showQualityModal(qualities, originalUrl, filename) {
        // Remove modal antigo se existir
        const oldModal = document.getElementById('qualityModal');
        if (oldModal) oldModal.remove();
        
        const modal = document.createElement('div');
        modal.id = 'qualityModal';
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0,0,0,0.9);
            z-index: 1000;
            display: flex;
            align-items: center;
            justify-content: center;
            font-family: sans-serif;
        `;
        
        modal.innerHTML = `
            <div style="background: #1a1a2e; border-radius: 12px; padding: 20px; width: 280px;">
                <h4 style="margin: 0 0 16px 0; color: #eee;">Escolha a qualidade</h4>
                <div id="qualityOptions" style="display: flex; flex-direction: column; gap: 8px;">
                    ${qualities.map(q => `
                        <button class="quality-option" data-url="${escapeHtml(q.url)}" data-name="${q.name}" style="
                            background: #16213e;
                            border: none;
                            padding: 10px;
                            border-radius: 8px;
                            color: #eee;
                            cursor: pointer;
                            font-size: 14px;
                            text-align: left;
                        ">
                            📺 ${q.name} ${q.resolution ? `(${q.resolution})` : ''}
                        </button>
                    `).join('')}
                </div>
                <button id="closeModal" style="
                    width: 100%;
                    margin-top: 12px;
                    background: #e94560;
                    border: none;
                    padding: 8px;
                    border-radius: 8px;
                    color: white;
                    cursor: pointer;
                ">Cancelar</button>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Adiciona eventos aos botões de qualidade
        modal.querySelectorAll('.quality-option').forEach(btn => {
            btn.addEventListener('click', () => {
                const qualityUrl = btn.dataset.url;
                const qualityName = btn.dataset.name;
                modal.remove();
                startDownload(qualityUrl, `${filename}_${qualityName}`, true);
            });
        });
        
        document.getElementById('closeModal').addEventListener('click', () => modal.remove());
    }
    
    btnReload.addEventListener('click', () => {
        btnReload.textContent = '🔄 Recarregando...';
        btnReload.disabled = true;
        chrome.runtime.sendMessage({ action: 'clearTabVideos', tabId: currentTabId }, () => {
            chrome.tabs.reload(currentTabId, { bypassCache: true });
            setTimeout(() => window.close(), 300);
        });
    });
    
    if (btnClear) {
        btnClear.addEventListener('click', () => {
            chrome.runtime.sendMessage({ action: 'clearTabVideos', tabId: currentTabId }, () => {
                loadVideos(currentTabId, '');
                btnClear.textContent = '✓ Limpo!';
                setTimeout(() => { btnClear.textContent = '🗑️ Limpar Lista'; }, 1000);
            });
        });
    }
    
    function truncateUrl(url, maxLength) {
        if (!url) return '';
        return url.length <= maxLength ? url : url.substring(0, maxLength) + '...';
    }
    
    function escapeHtml(str) {
        if (!str) return '';
        return str.replace(/[&<>]/g, function(m) {
            if (m === '&') return '&amp;';
            if (m === '<') return '&lt;';
            if (m === '>') return '&gt;';
            return m;
        });
    }
});