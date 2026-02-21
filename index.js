let synth = window.speechSynthesis;
let utterance = new SpeechSynthesisUtterance();
let __PDF_DOC,
  __CURRENT_PAGE = 1,
  __TOTAL_PAGES,
  canvas_width = 1000,
  pageHeight = -1,
  viewingPage = __CURRENT_PAGE,
  scrollHandlerBound = false,
  pageElementsByNumber = new Map(),
  currentSpeechMap = null,
  prevId = 0;

const ui = {
  $pdfLoader: $("#pdf-loader"),
  $pdfContents: $("#pdf-contents"),
  $pdfTotalPages: $("#pdf-total-pages"),
  $pdfContainer: $("#pdfContainer"),
  $uploadButton: $("#upload-button"),
  $fileToUpload: $("#file-to-upload"),
  $resumeButton: $("#resume-button"),
  $pauseButton: $("#pause-button"),
};

function populateVoiceList() {
  let voiceSelect = document.getElementById("voiceSelect");
  if (!synth || voiceSelect.childNodes.length) return;
  synth.getVoices().forEach(function (voice) {
    if (voice.lang.substring(0, 2) !== "en") return;
    let option = document.createElement("option");
    option.textContent = `${voice.name} (${voice.lang})${
      voice.default ? " — DEFAULT" : ""
    }`;
    option.dataset.lang = voice.lang;
    option.dataset.name = voice.name;
    voiceSelect.appendChild(option);
  });
}

if (synth && synth.onvoiceschanged !== undefined)
  synth.onvoiceschanged = populateVoiceList;
if (synth) populateVoiceList();

function handleError(error, context) {
  console.log(`[${context}]`, error);
  if (context === "pdf-load")
    alert("Failed to load the PDF. Please try another file.");
  if (context === "voice-select") console.warn("No available English voices.");
}

function rafThrottle(handler) {
  let ticking = false;
  return function () {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      ticking = false;
      handler();
    });
  };
}

function getPage(pageNumber) {
  if (!__PDF_DOC) {
    let error = new Error("PDF document not loaded");
    handleError(error, "get-page");
    return Promise.reject(error);
  }
  return __PDF_DOC.getPage(pageNumber).catch(function (error) {
    handleError(error, "get-page");
    throw error;
  });
}

function setHighlightWord(wordIndex) {
  if (!wordIndex) return;
  clearHighlightedWord(__CURRENT_PAGE, prevId);
  prevId = wordIndex;
  let element = document.getElementById(buildWordId(__CURRENT_PAGE, wordIndex));
  if (element) element.classList.add("highlight");
}

function findWordIndexForChar(wordStarts, charIndex, startIndex) {
  if (!wordStarts.length) return 0;
  if (charIndex <= wordStarts[0]) return 0;
  let low = Math.max(0, startIndex || 0);
  let high = wordStarts.length - 1;
  while (low < high) {
    let mid = Math.ceil((low + high) / 2);
    if (wordStarts[mid] <= charIndex) low = mid;
    else high = mid - 1;
  }
  return low;
}

function handleSpeechBoundary(event) {
  if (!currentSpeechMap || typeof event.charIndex !== "number") return;
  if (!currentSpeechMap.wordStarts.length) return;
  let charIndex = event.charIndex;
  if (typeof event.charLength === "number" && event.charLength > 0)
    charIndex += Math.floor(event.charLength / 2);
  if (charIndex <= currentSpeechMap.lastCharIndex) return;
  currentSpeechMap.lastCharIndex = charIndex;
  let i = findWordIndexForChar(
    currentSpeechMap.wordStarts,
    charIndex,
    currentSpeechMap.lastWordIndex
  );
  currentSpeechMap.lastWordIndex = i;
  setHighlightWord(currentSpeechMap.pageStartWordIndex + i);
}

function clearHighlightedWord(pageNumber, wordId) {
  if (!wordId) return;
  let element = document.getElementById(buildWordId(pageNumber, wordId));
  if (element) element.classList.remove("highlight");
}

function handleSpeechEnd() {
  currentSpeechMap = null;
  if (__CURRENT_PAGE != __TOTAL_PAGES) {
    clearHighlightedWord(__CURRENT_PAGE, prevId);
    __CURRENT_PAGE += 1;
    prevId = 0;
    startTextToSpeech();
    scrollToCurrentPage();
  }
}

function startSpeech(text, keepSpeechMap, shouldRefine) {
  if (synth.speaking) synth.cancel();
  if (!keepSpeechMap) currentSpeechMap = null;
  let voices = synth
    .getVoices()
    .filter((voice) => voice.lang.substring(0, 2) === "en");
  let selectedIndex = document.getElementById("voiceSelect").selectedIndex;
  if (voices.length === 0 || selectedIndex < 0) {
    handleError(new Error("No voice selected"), "voice-select");
  } else {
    utterance.voice = voices[selectedIndex] || null;
  }
  utterance.text = shouldRefine === false ? text : refineText(text);
  utterance.onerror = (error) => handleError(error, "speech");
  utterance.onboundary = handleSpeechBoundary;
  utterance.onend = handleSpeechEnd;
  synth.speak(utterance);
  resume();
}

function startSpeechFromWords(words, pageStartWordIndex) {
  let pageElements = getPageElements(__CURRENT_PAGE);
  if (!pageElements.wordStarts || !pageElements.speechText) {
    cachePageData(pageElements, words.join(" "), words);
  }
  let startIndex = Math.max(1, pageStartWordIndex);
  let baseChar = pageElements.wordStarts[startIndex - 1] || 0;
  let relativeWordStarts = pageElements.wordStarts
    .slice(startIndex - 1)
    .map((start) => start - baseChar);
  let speechText = pageElements.speechText.slice(baseChar);
  currentSpeechMap = {
    text: speechText,
    wordStarts: relativeWordStarts,
    pageStartWordIndex: startIndex,
    lastWordIndex: 0,
    lastCharIndex: -1,
  };
  setHighlightWord(startIndex);
  startSpeech(speechText, true, false);
}

function startTextToSpeech() {
  clearHighlightedWord(__CURRENT_PAGE, prevId);
  prevId = 0;
  getPageData(__CURRENT_PAGE)
    .then(function (pageElements) {
      let words = pageElements.words || [];
      if (!words.length) return startSpeech(pageElements.text || "");
      startSpeechFromWords(words, 1);
    })
    .catch(function (error) {
      handleError(error, "start-text-to-speech");
    });
}

function loadPage(pageNumber) {
  if (pageNumber > __TOTAL_PAGES) return;
  let pageElements = getPageElements(pageNumber);
  if (!pageElements.appended) {
    ui.$pdfContainer.append(
      pageElements.canvas,
      pageElements.textLayer,
      pageElements.annotationLayer,
    );
    pageElements.appended = true;
  }
  if (!pageElements.rendered)
    showPage(
      pageNumber,
      pageElements.canvas,
      pageElements.canvas.getContext("2d"),
    );
}

function handleWordClick($wordSpan, pageNumber, wordIndex) {
  clearHighlightedWord(__CURRENT_PAGE, prevId);
  __CURRENT_PAGE = pageNumber;
  prevId = wordIndex - 1;
  let clickedWord = $wordSpan.text().trim();
  getPageData(pageNumber)
    .then(function (pageElements) {
      let words = pageElements.words || [];
      if (wordIndex > 0 && wordIndex <= words.length)
        return startSpeechFromWords(words, wordIndex);
      startSpeech(clickedWord);
    })
    .catch(function (error) {
      handleError(error, "click-text-to-speech");
      startSpeech(clickedWord);
    });
}

function cachePageData(pageElements, text, words) {
  let resolvedWords = words || tokenizeText(text);
  let wordStarts = [];
  let speechText = "";
  let index = 0;
  for (let i = 0; i < resolvedWords.length; i++) {
    let word = resolvedWords[i];
    if (i) {
      speechText += " ";
      index += 1;
    }
    wordStarts.push(index);
    speechText += word;
    index += word.length;
  }
  Object.assign(pageElements, {
    text,
    words: resolvedWords,
    wordStarts,
    speechText,
  });
  return pageElements;
}

function getPageData(pageNumber) {
  let pageElements = getPageElements(pageNumber);
  if (pageElements.words && pageElements.words.length)
    return Promise.resolve(pageElements);
  if (pageElements.text)
    return Promise.resolve(cachePageData(pageElements, pageElements.text));
  return getPage(pageNumber)
    .then((page) => page.getTextContent())
    .then((content) =>
      cachePageData(
        pageElements,
        content.items.map((item) => item.str).join(" "),
      ),
    );
}

function tokenizeText(textContent) {
  return refineText(textContent)
    .split(" ")
    .map((word) => word.trim())
    .filter((word) => word && word[0] !== "-" && /[A-Za-z0-9]/.test(word));
}

function buildWordId(pageNumber, wordIndex) {
  return `word-${pageNumber}-${wordIndex}`;
}

function getPageElements(pageNumber) {
  if (pageElementsByNumber.has(pageNumber))
    return pageElementsByNumber.get(pageNumber);
  let canvas = document.createElement("canvas");
  canvas.id = "page" + pageNumber;
  canvas.width = canvas_width;
  canvas.className = "canvas";
  let textLayer = document.createElement("div");
  textLayer.id = "textLayer" + pageNumber;
  textLayer.className = "textLayer";
  let annotationLayer = document.createElement("div");
  annotationLayer.id = "annotationLayer" + pageNumber;
  annotationLayer.className = "annotationLayer";
  let pageElements = {
    canvas,
    textLayer,
    annotationLayer,
    appended: false,
    rendered: false,
    text: null,
    words: null,
    wordStarts: null,
    speechText: null,
  };
  pageElementsByNumber.set(pageNumber, pageElements);
  return pageElements;
}

function showPDF(pdf_url) {
  ui.$pdfLoader.show();
  PDFJS.getDocument({ url: pdf_url })
    .then(function (pdf_doc) {
      __PDF_DOC = pdf_doc;
      __TOTAL_PAGES = __PDF_DOC.numPages;
      viewingPage = 1;
      pageElementsByNumber.clear();
      pageHeight = -1;
      ui.$pdfContainer.empty();
      clearHighlightedWord(__CURRENT_PAGE, prevId);
      __CURRENT_PAGE = 1;
      prevId = 0;
      ui.$pdfLoader.hide();
      ui.$pdfContents.show();
      ui.$pdfTotalPages.text(__TOTAL_PAGES);
      loadPage(1);
    })
    .catch((error) => handleError(error, "pdf-load"));
}

async function showPage(pageNumber, canvas, ctx) {
  canvas.style.display = "none";
  $("#page-loader").show();
  try {
    let page = await getPage(pageNumber);
    let viewport = page.getViewport(canvas.width / page.getViewport(1).width);
    canvas.height = viewport.height;
    let renderTask = page.render({ canvasContext: ctx, viewport: viewport });
    if (renderTask && renderTask.promise) await renderTask.promise;
    canvas.style.display = "";
    $("#page-loader").hide();
    if (pageHeight <= 0)
      pageHeight = canvas.getBoundingClientRect().height || canvas.height;
    let [annotationData, text] = await Promise.all([
      page.getAnnotations(),
      page.getTextContent(),
    ]);
    let canvasOffset = $(canvas).offset() || { left: 0, top: 0 };
    let pageElements = getPageElements(pageNumber);
    if (annotationData.length) {
      let annotationLayer = pageElements.annotationLayer;
      $(annotationLayer)
        .html("")
        .show()
        .css({
          left: canvasOffset.left + "px",
          top: canvasOffset.top + "px",
          height: canvas.height + "px",
          width: canvas.width + "px",
        });
      try {
        PDFJS.AnnotationLayer.render({
          viewport: viewport.clone({ dontFlip: true }),
          div: annotationLayer,
          annotations: annotationData,
          page: page,
        });
      } catch {}
    }
    let textLayer = pageElements.textLayer;
    $(textLayer).css({
      left: canvasOffset.left + "px",
      top: canvasOffset.top + "px",
      height: canvas.height + "px",
      width: canvas.width + "px",
    });
    let textTask = PDFJS.renderTextLayer({
      textContent: text,
      container: textLayer,
      viewport: viewport,
      textDivs: [],
    });
    if (textTask && textTask.promise) await textTask.promise;
    wrapTextLayerWordsFromItems(pageNumber, text.items || []);
    pageElements.rendered = true;
    ensureScrollHandler();
  } catch (error) {
    handleError(error, "render-page");
  }
}

function wrapTextLayerWordsFromItems(pageNumber, textItems) {
  let allDivs = document.querySelectorAll(`#textLayer${pageNumber} > div`);
  let wordIndex = 1;
  let words = [];
  let rawTextParts = [];
  for (let i = 0; i < allDivs.length; i++) {
    let element = allDivs[i];
    let rawText =
      i < textItems.length ? textItems[i].str || "" : element.textContent || "";
    rawTextParts.push(rawText);
    let tokens = tokenizeText(rawText);
    element.innerHTML = tokens
      .map(function (word) {
        words.push(word);
        return `<span id="${buildWordId(pageNumber, wordIndex++)}">${word} </span>`;
      })
      .join("");
  }
  cachePageData(getPageElements(pageNumber), rawTextParts.join(" "), words);
}

function getPageHeight() {
  let page = document.getElementById("page1");
  return page ? page.getBoundingClientRect().height : 0;
}

function ensureScrollHandler() {
  if (scrollHandlerBound) {
    if (pageHeight <= 0) pageHeight = getPageHeight();
    return;
  }
  let currentPageElement = document.getElementById("pdf-current-page");
  let handler = rafThrottle(function () {
    if (pageHeight <= 0) pageHeight = getPageHeight();
    if (pageHeight > 0)
      currentPageElement.textContent =
        Math.floor(window.scrollY / pageHeight) + 1;
    if (__TOTAL_PAGES && viewingPage < __TOTAL_PAGES) {
      let scrollBottom = window.scrollY + window.innerHeight;
      let docHeight = document.documentElement.scrollHeight;
      if (scrollBottom >= docHeight * 0.9) loadPage(++viewingPage);
    }
  });
  $(window).scroll(handler);
  scrollHandlerBound = true;
}

ui.$uploadButton.on("click", function () {
  ui.$fileToUpload.trigger("click");
  ui.$pauseButton.hide();
  ui.$resumeButton.hide();
});
ui.$pdfContainer.on("click", ".textLayer span", function () {
  let parts = this.id ? this.id.split("-") : [];
  let pageNumber = parseInt(parts[1], 10) || __CURRENT_PAGE;
  let wordIndex = parseInt(parts[2], 10) || 0;
  handleWordClick($(this), pageNumber, wordIndex);
});
ui.$fileToUpload.on("change", function () {
  if (
    ["application/pdf"].indexOf(ui.$fileToUpload.get(0).files[0].type) == -1
  ) {
    alert("Error : Not a PDF");
    return;
  }
  ui.$uploadButton.hide();
  showPDF(URL.createObjectURL(ui.$fileToUpload.get(0).files[0]));
});

function resume() {
  ui.$resumeButton.hide();
  ui.$pauseButton.show();
  if (!synth.paused) synth.resume();
}

function pause() {
  ui.$pauseButton.hide();
  ui.$resumeButton.show();
  if (synth.speaking) synth.pause();
}

window.onbeforeunload = function () {
  synth.cancel();
};

function refineText(text) {
  return text.replace(/\x00/g, "").replace(/\s+/g, " ").trim();
}

function scrollToCurrentPage() {
  let target = document.getElementById("page" + __CURRENT_PAGE);
  if (target) target.scrollIntoView();
}

window.startTextToSpeech = startTextToSpeech;
window.scrollToCurrentPage = scrollToCurrentPage;
