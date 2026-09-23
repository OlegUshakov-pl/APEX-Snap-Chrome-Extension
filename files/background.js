// По клику на иконку расширения открываем страницу в новой вкладке
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL("page.html") });
});
