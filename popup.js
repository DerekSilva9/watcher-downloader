document.addEventListener('DOMContentLoaded', () => {
  const videoList = document.getElementById('videoList');
  const btnReload = document.getElementById('forceReload');

  chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
    const tabId = tabs[0].id;

    // Função marota que roda dentro da página do vídeo pra pegar os dados
    let pageMeta = { title: 'video_baixado', thumb: '' };
    try {
      const [results] = await chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: () => {
          const ogTitle = document.querySelector('meta[property="og:title"]')?.content;
          const pageTitle = document.title;
          const videoPoster = document.querySelector('video')?.poster;
          const ogImg = document.querySelector('meta[property="og:image"]')?.content;
          
          return {
            title: ogTitle || pageTitle || 'video_baixado',
            thumb: videoPoster || ogImg || ''
          };
        }
      });
      if (results?.result) pageMeta = results.result;
    } catch (e) {
      console.log("Não deu pra ler os metadados da página:", e);
    }

    // Limpa caracteres estranhos do título pra não dar erro no Windows/Linux ao salvar
    const cleanTitle = pageMeta.title.replace(/[\\/:*?"<>|]/g, '_').trim();

    chrome.storage.local.get(['videos'], (res) => {
      const videos = res.videos || {};
      const tabVideos = videos[tabId] || [];
      const filteredVideos = tabVideos.filter(url => !url.toLowerCase().includes('_tlp_'));

      if (filteredVideos.length === 0) {
        videoList.innerHTML = "Nenhum vídeo real detectado ainda.";
        return;
      }

      videoList.innerHTML = '';
      filteredVideos.forEach((url, index) => {
        const div = document.createElement('div');
        div.className = 'video-item';
        div.style = "margin-top: 10px; padding: 10px; background: #eee; word-break: break-all; display: flex; flex-direction: column; gap: 5px;";
        
        const isHLS = url.includes('.m3u8');
        
        // Se achou thumbnail, bota ela na tela
        const thumbHtml = pageMeta.thumb ? `<img src="${pageMeta.thumb}" style="width: 100%; max-height: 120px; object-fit: cover; border-radius: 4px;">` : '';

        div.innerHTML = `
          ${thumbHtml}
          <strong>${cleanTitle} ${isHLS ? '(Stream)' : ''}</strong>
          <small style="color: #666;">${url.split('?')[0].substring(0, 40)}...</small>
        `;
        
        const btn = document.createElement('button');
        btn.className = 'download-btn';
        btn.style = "background: #4CAF50; color: white; border: none; padding: 8px; cursor: pointer; margin-top: 5px;";
        btn.innerText = 'Baixar Vídeo';
        
        btn.onclick = async () => {
          if (isHLS) {
            btn.innerText = 'Baixando pedaços...';
            btn.disabled = true;
            try {
              await downloadHLS(url, btn, cleanTitle);
              btn.innerText = 'Concluído!';
            } catch (err) {
              btn.innerText = 'Erro ao baixar';
              console.error(err);
            }
          } else {
            chrome.downloads.download({ url: url, filename: `${cleanTitle}.mp4` });
          }
        };

        div.appendChild(btn);
        videoList.appendChild(div);
      });
    });

    btnReload.onclick = () => {
      chrome.storage.local.get(['videos'], (res) => {
        const videos = res.videos || {};
        videos[tabId] = [];
        chrome.storage.local.set({ videos }, () => {
          chrome.tabs.reload(tabId);
          window.close();
        });
      });
    };
  });
});

// Atualizado pra receber o nome inteligente do arquivo
async function downloadHLS(m3u8Url, buttonElement, fileName) {
  const response = await fetch(m3u8Url);
  const text = await response.text();
  
  const lines = text.split('\n');
  const baseUrl = m3u8Url.substring(0, m3u8Url.lastIndexOf('/') + 1);
  const segments = [];
  
  lines.forEach(line => {
    line = line.trim();
    if (line && !line.startsWith('#')) {
      if (!line.startsWith('http')) {
        segments.push(baseUrl + line);
      } else {
        segments.push(line);
      }
    }
  });

  if (segments.length === 0) throw new Error('Sem segmentos no m3u8');

  const chunks = [];
  for (let i = 0; i < segments.length; i++) {
    buttonElement.innerText = `Baixando: ${i + 1}/${segments.length}`;
    try {
      const segRes = await fetch(segments[i]);
      const buffer = await segRes.arrayBuffer();
      chunks.push(buffer);
    } catch (e) {
      console.error(`Erro no pedaço ${i}:`, e);
    }
  }

  const finalBlob = new Blob(chunks, { type: 'video/mp4' });
  const blobUrl = URL.createObjectURL(finalBlob);
  
  chrome.downloads.download({
    url: blobUrl,
    filename: `${fileName}.mp4` // Smartnaming aqui!
  });
}