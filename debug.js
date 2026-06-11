document.addEventListener('DOMContentLoaded', () => {
  const tbody = document.getElementById('logTable');

  chrome.storage.local.get(['logs'], (res) => {
    const allLogs = res.logs || {};
    let html = '';

    // Junta os logs de todas as abas e inverte pra mostrar o mais recente em cima
    const logsArray = Object.values(allLogs).flat().reverse();

    logsArray.forEach(log => {
      html += `<tr>
        <td>${log.time}</td>
        <td>${log.type}</td>
        <td><a href="${log.url}" target="_blank">${log.url}</a></td>
      </tr>`;
    });

    tbody.innerHTML = html || '<tr><td colspan="3">Nenhum log encontrado... a rede tá parada.</td></tr>';
  });

  document.getElementById('clearLogs').onclick = () => {
    chrome.storage.local.set({ logs: {} }, () => {
      location.reload();
    });
  };
});