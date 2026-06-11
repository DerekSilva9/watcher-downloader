function collectVideos() {

    const videos = document.querySelectorAll("video");

    videos.forEach(video => {

        if (video.src) {

            chrome.runtime.sendMessage({
                type: "CONTENT_VIDEO",
                url: video.src
            });
        }

        const sources =
            video.querySelectorAll("source");

        sources.forEach(source => {

            if (source.src) {

                chrome.runtime.sendMessage({
                    type: "CONTENT_VIDEO",
                    url: source.src
                });
            }
        });
    });
}

collectVideos();

const observer = new MutationObserver(() => {
    collectVideos();
});

observer.observe(document.documentElement, {
    childList: true,
    subtree: true
});