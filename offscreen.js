

console.log('[Offscreen] Mux.js carregado?', typeof muxjs);

document.addEventListener('DOMContentLoaded', async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const videoUrl = urlParams.get('url');
    const videoTitle = urlParams.get('title') || 'video';

    if (!videoUrl) {
        chrome.runtime.sendMessage({ action: 'finish_download' });
        return;
    }

    try {
        console.log('[Offscreen] Iniciando download...');
        
        // ========== PASSO 1: Busca playlist ==========
        let response = await fetch(videoUrl);
        
        if (!response.ok) {
            console.error(`[Offscreen] ERRO ${response.status}`);
            chrome.runtime.sendMessage({ action: 'finish_download' });
            return;
        }
        
        let text = await response.text();
        
        if (!text.includes('#EXTM3U')) {
            console.error('[Offscreen] Não é playlist HLS');
            chrome.runtime.sendMessage({ action: 'finish_download' });
            return;
        }

        // ========== PASSO 2: Encontra playlist de qualidade ==========
        let playlistUrl = videoUrl;
        
        const lines = text.split('\n');
        for (let i = 0; i < lines.length; i++) {
            if (lines[i] && lines[i].includes('#EXT-X-STREAM-INF')) {
                const qualityUrl = lines[i + 1];
                if (qualityUrl && qualityUrl.trim() && !qualityUrl.startsWith('#')) {
                    playlistUrl = new URL(qualityUrl.trim(), videoUrl).href;
                    console.log('[Offscreen] Playlist de qualidade:', playlistUrl);
                    break;
                }
            }
        }

        // ========== PASSO 3: Busca segmentos .ts ==========
        response = await fetch(playlistUrl);
        
        if (!response.ok) {
            console.error(`[Offscreen] ERRO na playlist: ${response.status}`);
            chrome.runtime.sendMessage({ action: 'finish_download' });
            return;
        }
        
        text = await response.text();
        
        const segments = text.split('\n')
            .filter(l => l && l.trim() && !l.startsWith('#'))
            .map(l => new URL(l.trim(), playlistUrl).href);
        
        console.log(`[Offscreen] Segmentos .ts encontrados: ${segments.length}`);
        
        if (segments.length === 0) {
            console.error('[Offscreen] Nenhum segmento');
            chrome.runtime.sendMessage({ action: 'finish_download' });
            return;
        }

        // ========== PASSO 4: Configura o mux.js ==========
        const transmuxer = new muxjs.mp4.Transmuxer();
        const mp4Chunks = [];
        
        // Recebe os segmentos MP4 prontos
        transmuxer.on('data', (segment) => {
            if (segment.initSegment) {
                console.log('[Mux.js] Header MP4 recebido, tamanho:', segment.initSegment.byteLength);
                mp4Chunks.push(new Uint8Array(segment.initSegment));
            }
            if (segment.data) {
                mp4Chunks.push(new Uint8Array(segment.data));
            }
        });
        
        transmuxer.on('done', () => {
            console.log('[Mux.js] Processamento finalizado');
        });
        
        // ========== PASSO 5: Baixa e processa os segmentos .ts ==========
        let downloadedChunks = 0;
        
        for (let i = 0; i < segments.length; i++) {
            try {
                const segRes = await fetch(segments[i]);
                
                if (segRes.ok) {
                    const buffer = await segRes.arrayBuffer();
                    if (buffer.byteLength > 0) {
                        // Manda o .ts pro mux.js converter
                        transmuxer.push(new Uint8Array(buffer));
                        downloadedChunks++;
                    }
                }
                
                const pct = Math.floor((downloadedChunks / segments.length) * 100);
                chrome.runtime.sendMessage({ action: 'update_progress', pct: `${pct}%` });
                
                if (downloadedChunks % 10 === 0 || downloadedChunks === segments.length) {
                    console.log(`[Offscreen] Progresso: ${downloadedChunks}/${segments.length} (${pct}%)`);
                }
                
            } catch(e) {
                console.warn(`[Offscreen] Segmento ${i+1} falhou: ${e.message}`);
            }
        }
        
        // Finaliza e limpa
        transmuxer.flush();
        
        console.log(`[Offscreen] Total de chunks MP4 gerados: ${mp4Chunks.length}`);
        
        if (mp4Chunks.length === 0) {
            console.error('[Offscreen] Nenhum chunk MP4 foi gerado!');
            chrome.runtime.sendMessage({ action: 'finish_download' });
            return;
        }
        
        // ========== PASSO 6: Junta tudo num único arquivo MP4 ==========
        const totalLength = mp4Chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
        const concatenated = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of mp4Chunks) {
            concatenated.set(chunk, offset);
            offset += chunk.byteLength;
        }
        
        // ========== PASSO 7: Download como MP4 ==========
        const blob = new Blob([concatenated], { type: 'video/mp4' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${sanitizeFilename(videoTitle)}.mp4`;
        document.body.appendChild(a);
        a.click();
        
        console.log(`[Offscreen] Download concluído! Tamanho: ${(blob.size / 1024 / 1024).toFixed(2)} MB`);
        
        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            chrome.runtime.sendMessage({ action: 'finish_download' });
        }, 1000);
        
    } catch (err) {
        console.error('[Offscreen] Erro fatal:', err);
        chrome.runtime.sendMessage({ action: 'finish_download' });
    }
});

function sanitizeFilename(name) {
    return name.replace(/[\\/:*?"<>|]/g, '_').substring(0, 100);
}