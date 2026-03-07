let synth = window.speechSynthesis;
let utterance = new SpeechSynthesisUtterance();
let __PDF_DOC,
  __CURRENT_PAGE = 1,
  __TOTAL_PAGES,
  canvas_width = 1000,
  pageHeight = -1,
  defaultPageHeight = 0,
  viewingPage = __CURRENT_PAGE,
  isTtsActive = false,
  scrollHandlerBound = false,
  pageElementsByNumber = new Map(),
  currentSpeechMap = null,
  prevId = 0,
  paragraphJumpToken = 0;

const pageGap = 30;
const ui = {
  $landingPage: $("#landing-page"),
  $pdfMainContainer: $("#pdf-main-container"),
  $pdfLoader: $("#pdf-loader"),
  $pdfContents: $("#pdf-contents"),
  $pdfTotalPages: $("#pdf-total-pages"),
  $pdfCurrentPage: $("#pdf-current-page"),
  $pdfContainer: $("#pdfContainer"),
  $pdfTocItems: $("#pdf-toc-items"),
  $tocToggle: $("#toc-toggle"),
  $tocDialog: $("#pdf-toc-dialog"),
  $uploadButton: $("#upload-button"),
  $fileToUpload: $("#file-to-upload"),
  $speechRate: $("#speech-rate"),
  $scrollButton: $("#scroll"),
  $resumeButton: $("#resume-button"),
  $pauseButton: $("#pause-button"),
  $rewindButton: $("#rewind-button"),
  $forwardButton: $("#forward-button"),
};

function setAppMode(mode) {
  if (mode === "viewer") {
    ui.$landingPage.hide();
    ui.$pdfMainContainer.show();
    return;
  }
  ui.$pdfMainContainer.hide();
  ui.$landingPage.show();
}

function setReadingControlsVisible(isVisible) {
  isTtsActive = isVisible;
  updateReadingButtonVisibility();
  if (isVisible) {
    ui.$rewindButton.show();
    ui.$forwardButton.show();
    return;
  }
  ui.$pauseButton.hide();
  ui.$resumeButton.hide();
  ui.$rewindButton.hide();
  ui.$forwardButton.hide();
}

function updateReadingButtonVisibility() {
  if (isTtsActive && viewingPage !== __CURRENT_PAGE) ui.$scrollButton.show();
  else ui.$scrollButton.hide();
}

function getSelectedSpeechRate() {
  let rate = parseFloat(ui.$speechRate.val());
  if (Number.isNaN(rate)) return 1;
  return Math.min(Math.max(rate, 0.5), 2);
}

setReadingControlsVisible(false);
setAppMode("landing");

function populateVoiceList() {
  let voiceSelect = document.getElementById("voiceSelect");
  if (!synth || voiceSelect.childNodes.length) return;
  synth.getVoices().forEach(function (voice) {
    if (voice.lang.substring(0, 2) !== "en") return;
    let option = document.createElement("option");
    option.textContent = `${voice.name} (${voice.lang})`;
    option.dataset.lang = voice.lang;
    option.dataset.name = voice.name;
    voiceSelect.appendChild(option);
  });
  if (voiceSelect.options.length)
    voiceSelect.selectedIndex = voiceSelect.options.length - 1;
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

function getPageShell(pageNumber) {
  let shell = document.querySelector(
    `.page-shell[data-page="${pageNumber}"]`,
  );
  if (shell) return shell;
  shell = document.createElement("div");
  shell.className = "page-shell";
  shell.dataset.page = pageNumber;
  let next = document.querySelector(
    `.page-shell[data-page="${pageNumber + 1}"]`,
  );
  if (next) next.before(shell);
  else ui.$pdfContainer.append(shell);
  if (defaultPageHeight > 0) shell.style.minHeight = defaultPageHeight + "px";
  return shell;
}

function ensurePageShells() {
  if (!__TOTAL_PAGES) return;
  ui.$pdfContainer.empty();
  for (let page = 1; page <= __TOTAL_PAGES; page++) {
    let shell = document.createElement("div");
    shell.className = "page-shell";
    shell.dataset.page = page;
    if (defaultPageHeight > 0)
      shell.style.minHeight = defaultPageHeight + "px";
    ui.$pdfContainer.append(shell);
  }
}

function normalizePageNumber(value) {
  let parsed = parseInt(value, 10);
  if (Number.isNaN(parsed) || !__TOTAL_PAGES) return null;
  return Math.min(Math.max(parsed, 1), __TOTAL_PAGES);
}

function jumpToPage(value) {
  if (!__PDF_DOC) return;
  let target = normalizePageNumber(value);
  if (!target) {
    ui.$pdfCurrentPage.val(viewingPage || 1);
    return;
  }
  viewingPage = target;
  if (!isTtsActive) __CURRENT_PAGE = target;
  ui.$pdfCurrentPage.val(target);
  updateReadingButtonVisibility();
  loadPage(target);
  let targetElement =
    document.querySelector(`.page-shell[data-page="${target}"]`) ||
    document.getElementById("page" + target);
  if (targetElement) targetElement.scrollIntoView();
}

async function resolveOutlinePageNumber(outlineItem) {
  if (!__PDF_DOC || !outlineItem) return null;
  let destination = outlineItem.dest || outlineItem.destination || null;
  if (!destination && outlineItem.url) return null;
  if (typeof destination === "string") {
    destination = await __PDF_DOC.getDestination(destination);
  }
  if (!destination || !destination.length) return null;
  let ref = destination[0];
  let pageIndex = await __PDF_DOC.getPageIndex(ref);
  return pageIndex + 1;
}

async function renderOutlineItems(items, container, depth) {
  if (!items || !items.length) return;
  for (let i = 0; i < items.length; i++) {
    let item = items[i];
    let pageNumber = null;
    try {
      pageNumber = await resolveOutlinePageNumber(item);
    } catch {}
    let entry = document.createElement("div");
    entry.className = "toc-item";
    entry.textContent = item.title || "Untitled";
    entry.style.paddingLeft = `${depth * 12}px`;
    if (pageNumber) {
      entry.dataset.page = pageNumber;
      entry.title = `Page ${pageNumber}`;
    } else if (item.url) {
      entry.title = "External link";
    }
    container.appendChild(entry);
    if (item.items && item.items.length)
      await renderOutlineItems(item.items, container, depth + 1);
  }
}

async function loadTableOfContents() {
  if (!__PDF_DOC) return;
  ui.$pdfTocItems.empty();
  ui.$pdfTocItems.text("Loading...");
  try {
    let outline = await __PDF_DOC.getOutline();
    ui.$pdfTocItems.empty();
    if (!outline || !outline.length) {
      ui.$pdfTocItems.text("No outline available");
      return;
    }
    await renderOutlineItems(outline, ui.$pdfTocItems.get(0), 0);
  } catch (error) {
    handleError(error, "outline-load");
    ui.$pdfTocItems.text("No outline available");
  }
}

function setTocOpen(isOpen) {
  if (isOpen) {
    if (!ui.$tocDialog.prop("open")) ui.$tocDialog.get(0).showModal();
  } else if (ui.$tocDialog.prop("open")) {
    ui.$tocDialog.get(0).close();
  }
  ui.$tocToggle.attr("aria-expanded", isOpen ? "true" : "false");
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
    return;
  }
  setReadingControlsVisible(false);
}

function startSpeech(text, keepSpeechMap, shouldRefine) {
  if (synth.speaking) synth.cancel();
  if (!keepSpeechMap) currentSpeechMap = null;
  setReadingControlsVisible(true);
  let voices = synth
    .getVoices()
    .filter((voice) => voice.lang.substring(0, 2) === "en");
  let selectedIndex = document.getElementById("voiceSelect").selectedIndex;
  if (voices.length === 0 || selectedIndex < 0) {
    handleError(new Error("No voice selected"), "voice-select");
  } else {
    utterance.voice = voices[selectedIndex] || null;
  }
  utterance.rate = getSelectedSpeechRate();
  utterance.text = shouldRefine === false ? text : refineText(text);
  utterance.onerror = (error) => {
    setReadingControlsVisible(false);
    handleError(error, "speech");
  };
  utterance.onboundary = handleSpeechBoundary;
  utterance.onend = handleSpeechEnd;
  synth.speak(utterance);
  resume();
}

function startSpeechFromWords(words, pageStartWordIndex) {
  viewingPage = __CURRENT_PAGE;
  updateReadingButtonVisibility();
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
    $(pageElements.wrapper).append(
      pageElements.canvas,
      pageElements.textLayer,
      pageElements.annotationLayer,
    );
    pageElements.appended = true;
  }
  if (pageElements.rendered || pageElements.renderPromise) return;
  pageElements.renderPromise = showPage(
    pageNumber,
    pageElements.canvas,
    pageElements.canvas.getContext("2d"),
  ).finally(function () {
    pageElements.renderPromise = null;
  });
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

function buildParagraphStartsFromWords(words) {
  if (!words || !words.length) return [];
  let starts = [1];
  let wordsSinceLastBreak = 0;
  const softBreakAfterWords = 28;
  const hardBreakAfterWords = 90;
  for (let i = 0; i < words.length; i++) {
    wordsSinceLastBreak += 1;
    let isSentenceBoundary = /[.!?]["')\]]?$/.test(words[i]);
    if (
      (wordsSinceLastBreak >= softBreakAfterWords && isSentenceBoundary) ||
      wordsSinceLastBreak >= hardBreakAfterWords
    ) {
      if (i + 2 <= words.length) starts.push(i + 2);
      wordsSinceLastBreak = 0;
    }
  }
  return starts;
}

function normalizeParagraphStarts(starts, totalWords) {
  if (!totalWords) return [];
  let uniqueStarts = new Set();
  if (Array.isArray(starts)) {
    for (let i = 0; i < starts.length; i++) {
      let parsed = parseInt(starts[i], 10);
      if (!Number.isNaN(parsed) && parsed >= 1 && parsed <= totalWords)
        uniqueStarts.add(parsed);
    }
  }
  uniqueStarts.add(1);
  return Array.from(uniqueStarts).sort((a, b) => a - b);
}

function buildTextFromItems(items) {
  if (!items || !items.length) return "";
  let text = "";
  for (let i = 0; i < items.length; i++) {
    let item = items[i] || {};
    let raw = typeof item.str === "string" ? item.str : "";
    if (raw) {
      if (text && text[text.length - 1] !== "\n") text += " ";
      text += raw;
    }
    if (item.hasEOL) text += "\n";
  }
  return text;
}

function deriveParagraphStartsFromItems(textItems, words) {
  if (!textItems || !textItems.length) return buildParagraphStartsFromWords(words);
  let lines = [];
  let lineWords = [];
  let lineText = "";
  let lineX = null;
  let lineY = null;
  let lineHeight = null;
  const commitLine = () => {
    lines.push({
      words: lineWords,
      text: lineText.trim(),
      x: lineX,
      y: lineY,
      height: lineHeight,
    });
    lineWords = [];
    lineText = "";
    lineX = null;
    lineY = null;
    lineHeight = null;
  };
  for (let i = 0; i < textItems.length; i++) {
    let item = textItems[i] || {};
    let raw = typeof item.str === "string" ? item.str : "";
    let tokens = tokenizeText(raw);
    let itemX =
      item.transform && item.transform.length > 5 ? item.transform[4] : null;
    let itemY =
      item.transform && item.transform.length > 5 ? item.transform[5] : null;
    let itemHeight = null;
    if (typeof item.height === "number") itemHeight = Math.abs(item.height);
    else if (item.transform && typeof item.transform[0] === "number")
      itemHeight = Math.abs(item.transform[0]);
    if (
      lineWords.length &&
      typeof itemY === "number" &&
      typeof lineY === "number" &&
      Number.isFinite(itemY) &&
      Number.isFinite(lineY)
    ) {
      let verticalShift = Math.abs(itemY - lineY);
      let referenceHeight = Math.max(lineHeight || 0, itemHeight || 0, 1);
      if (verticalShift > referenceHeight * 0.45) commitLine();
    }
    if (tokens.length) {
      lineWords = lineWords.concat(tokens);
      if (lineText) lineText += " ";
      lineText += raw.trim();
      if (lineX === null && typeof itemX === "number") {
        lineX = itemX;
        lineY = itemY;
      }
      if (lineHeight === null) {
        lineHeight = itemHeight;
      }
    }
    if (item.hasEOL) commitLine();
  }
  if (lineWords.length || lineText) commitLine();
  let starts = [];
  let wordCursor = 1;
  let previousTextLine = null;
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    if (!line.words.length) continue;
    let isParagraphStart = starts.length === 0;
    if (!isParagraphStart && previousTextLine) {
      let hasLargeVerticalGap = false;
      if (
        typeof line.y === "number" &&
        typeof previousTextLine.y === "number" &&
        Number.isFinite(line.y) &&
        Number.isFinite(previousTextLine.y)
      ) {
        let gap = Math.abs(previousTextLine.y - line.y);
        let baseHeight = Math.max(
          line.height || 0,
          previousTextLine.height || 0,
          1,
        );
        hasLargeVerticalGap = gap > baseHeight * 1.7;
      }
      let isIndentedLine = false;
      if (
        typeof line.x === "number" &&
        typeof previousTextLine.x === "number" &&
        Number.isFinite(line.x) &&
        Number.isFinite(previousTextLine.x)
      ) {
        isIndentedLine = line.x - previousTextLine.x > 14;
      }
      let endedLikeSentence = /[.!?]["')\]]?$/.test(
        (previousTextLine.text || "").trim(),
      );
      let startsLikeSentence = /^[A-Z0-9"“(\[]/.test(line.words[0] || "");
      if (
        hasLargeVerticalGap ||
        isIndentedLine ||
        (endedLikeSentence && startsLikeSentence)
      ) {
        isParagraphStart = true;
      }
    }
    if (isParagraphStart) starts.push(wordCursor);
    wordCursor += line.words.length;
    previousTextLine = line;
  }
  if (!starts.length) starts = buildParagraphStartsFromWords(words);
  return starts;
}

function findCurrentParagraphIndex(starts, currentWord) {
  if (!starts || !starts.length) return -1;
  let index = 0;
  for (let i = 0; i < starts.length; i++) {
    if (starts[i] <= currentWord) index = i;
    else break;
  }
  return index;
}

async function jumpParagraph(direction) {
  if (!__PDF_DOC) return;
  if (direction !== 1 && direction !== -1) return;
  let requestToken = ++paragraphJumpToken;
  let startPage = __CURRENT_PAGE || 1;
  let startWord = Math.max(
    currentSpeechMap
      ? currentSpeechMap.pageStartWordIndex + currentSpeechMap.lastWordIndex
      : prevId,
    1,
  );
  let previousPage = __CURRENT_PAGE;
  let previousWord = prevId;
  let page = startPage;
  while (page >= 1 && page <= (__TOTAL_PAGES || 1)) {
    let pageElements;
    try {
      pageElements = await getPageData(page);
    } catch (error) {
      handleError(error, "paragraph-jump");
      return;
    }
    if (requestToken !== paragraphJumpToken) return;
    let words = pageElements.words || [];
    if (!words.length) {
      page += direction;
      continue;
    }
    let paragraphStarts = normalizeParagraphStarts(
      pageElements.paragraphStarts || buildParagraphStartsFromWords(words),
      words.length,
    );
    let targetWord = null;
    if (direction > 0) {
      let threshold = page === startPage ? startWord : 0;
      for (let i = 0; i < paragraphStarts.length; i++) {
        if (paragraphStarts[i] > threshold) {
          targetWord = paragraphStarts[i];
          break;
        }
      }
    } else if (page === startPage) {
      let paragraphIndex = findCurrentParagraphIndex(paragraphStarts, startWord);
      if (paragraphIndex > 0) targetWord = paragraphStarts[paragraphIndex - 1];
    } else {
      targetWord = paragraphStarts[paragraphStarts.length - 1];
    }
    if (targetWord) {
      clearHighlightedWord(previousPage, previousWord);
      __CURRENT_PAGE = page;
      viewingPage = page;
      ui.$pdfCurrentPage.val(page);
      loadPage(page);
      if (page !== startPage) scrollToCurrentPage();
      prevId = Math.max(targetWord - 1, 0);
      startSpeechFromWords(words, targetWord);
      return;
    }
    page += direction;
  }
}

function forwardParagraph() {
  if (!synth) return;
  if (!isTtsActive && !synth.speaking && !currentSpeechMap) return;
  jumpParagraph(1);
}

function rewindParagraph() {
  if (!synth) return;
  if (!isTtsActive && !synth.speaking && !currentSpeechMap) return;
  jumpParagraph(-1);
}

function cachePageData(pageElements, text, words, paragraphStarts) {
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
    paragraphStarts: normalizeParagraphStarts(
      paragraphStarts || buildParagraphStartsFromWords(resolvedWords),
      resolvedWords.length,
    ),
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
    .then((content) => {
      let items = content.items || [];
      let text = buildTextFromItems(items);
      let words = tokenizeText(text);
      let paragraphStarts = deriveParagraphStartsFromItems(items, words);
      return cachePageData(pageElements, text, words, paragraphStarts);
    });
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
  let wrapper = getPageShell(pageNumber);
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
    wrapper,
    canvas,
    textLayer,
    annotationLayer,
    appended: false,
    rendered: false,
    renderPromise: null,
    text: null,
    words: null,
    paragraphStarts: null,
    wordStarts: null,
    speechText: null,
  };
  pageElementsByNumber.set(pageNumber, pageElements);
  return pageElements;
}

function showPDF(pdf_url) {
  setAppMode("viewer");
  ui.$pdfContents.hide();
  ui.$pdfLoader.show();
  PDFJS.getDocument({ url: pdf_url })
    .then(function (pdf_doc) {
      __PDF_DOC = pdf_doc;
      __TOTAL_PAGES = __PDF_DOC.numPages;
      viewingPage = 1;
      pageElementsByNumber.clear();
      pageHeight = -1;
      defaultPageHeight = 0;
      ensurePageShells();
      clearHighlightedWord(__CURRENT_PAGE, prevId);
      __CURRENT_PAGE = 1;
      prevId = 0;
      setReadingControlsVisible(false);
      ui.$pdfLoader.hide();
      ui.$pdfContents.show();
      ui.$pdfTotalPages.text(__TOTAL_PAGES);
      ui.$pdfCurrentPage.attr("max", __TOTAL_PAGES);
      ui.$pdfCurrentPage.val(__CURRENT_PAGE);
      loadPage(1);
      loadTableOfContents();
      setTocOpen(false);
    })
    .catch((error) => {
      setReadingControlsVisible(false);
      ui.$pdfLoader.hide();
      setAppMode("landing");
      handleError(error, "pdf-load");
    });
}

async function showPage(pageNumber, canvas, ctx) {
  canvas.style.visibility = "hidden";
  $("#page-loader").show();
  try {
    let page = await getPage(pageNumber);
    let viewport = page.getViewport(canvas.width / page.getViewport(1).width);
    canvas.height = viewport.height;
    let renderTask = page.render({ canvasContext: ctx, viewport: viewport });
    if (renderTask && renderTask.promise) await renderTask.promise;
    canvas.style.visibility = "visible";
    $("#page-loader").hide();
    if (pageHeight <= 0)
      pageHeight = canvas.getBoundingClientRect().height || canvas.height;
    if (!defaultPageHeight && pageHeight > 0) {
      defaultPageHeight = pageHeight;
      document.querySelectorAll(".page-shell").forEach((shell) => {
        if (!shell.style.minHeight)
          shell.style.minHeight = defaultPageHeight + "px";
      });
    }
    let [annotationData, text] = await Promise.all([
      page.getAnnotations(),
      page.getTextContent(),
    ]);
    let pageElements = getPageElements(pageNumber);
    let wrapper = pageElements.wrapper;
    if (wrapper) wrapper.style.minHeight = canvas.height + "px";
    if (annotationData.length) {
      let annotationLayer = pageElements.annotationLayer;
      $(annotationLayer)
        .html("")
        .show()
        .css({
          left: "0px",
          top: "0px",
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
      left: "0px",
      top: "0px",
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
  let pageText = buildTextFromItems(
    textItems && textItems.length ? textItems : rawTextParts.map((text) => ({ str: text })),
  );
  let paragraphStarts = deriveParagraphStartsFromItems(textItems || [], words);
  cachePageData(getPageElements(pageNumber), pageText, words, paragraphStarts);
}

function getPageHeight() {
  let page = document.getElementById("page1");
  return page ? page.getBoundingClientRect().height : 0;
}

function estimateCurrentPage() {
  if (!defaultPageHeight) return viewingPage || __CURRENT_PAGE;
  let estimated =
    Math.floor(window.scrollY / (defaultPageHeight + pageGap)) + 1;
  return Math.min(Math.max(estimated, 1), __TOTAL_PAGES || 1);
}

function loadPagesAround(pageNumber) {
  if (!__TOTAL_PAGES) return;
  let pages = [pageNumber - 1, pageNumber, pageNumber + 1];
  pages.forEach((page) => {
    if (page >= 1 && page <= __TOTAL_PAGES) loadPage(page);
  });
}

function ensureScrollHandler() {
  if (scrollHandlerBound) {
    if (pageHeight <= 0) pageHeight = getPageHeight();
    return;
  }
  let currentPageElement = document.getElementById("pdf-current-page");
  let handler = rafThrottle(function () {
    if (pageHeight <= 0) pageHeight = getPageHeight();
    if (__TOTAL_PAGES) {
      let estimatedPage = estimateCurrentPage();
      viewingPage = estimatedPage;
      if (!isTtsActive) __CURRENT_PAGE = estimatedPage;
      currentPageElement.value = estimatedPage;
      updateReadingButtonVisibility();
      loadPagesAround(estimatedPage);
    }
  });
  $(window).scroll(handler);
  scrollHandlerBound = true;
}

ui.$uploadButton.on("click", function () {
  ui.$fileToUpload.trigger("click");
  setReadingControlsVisible(false);
});
ui.$pdfContainer.on("click", ".textLayer span", function () {
  let parts = this.id ? this.id.split("-") : [];
  let pageNumber = parseInt(parts[1], 10) || __CURRENT_PAGE;
  let wordIndex = parseInt(parts[2], 10) || 0;
  handleWordClick($(this), pageNumber, wordIndex);
});
ui.$tocToggle.on("click", function () {
  let isOpen = ui.$tocDialog.prop("open");
  setTocOpen(!isOpen);
});
ui.$tocDialog.on("click", function (event) {
  if (event.target === this) setTocOpen(false);
});
ui.$pdfTocItems.on("click", ".toc-item", function () {
  let page = parseInt(this.dataset.page, 10);
  if (!page) return;
  setTocOpen(false);
  jumpToPage(page);
});
ui.$pdfCurrentPage.on("change", function () {
  jumpToPage(this.value);
});
ui.$pdfCurrentPage.on("keydown", function (event) {
  if (event.key !== "Enter") return;
  event.preventDefault();
  this.blur();
  jumpToPage(this.value);
});
function isEditableTarget(target) {
  return !!(
    target &&
    (target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.tagName === "SELECT" ||
      target.tagName === "BUTTON" ||
      target.isContentEditable)
  );
}
$(document).on("keydown", function (event) {
  let target = event.target;
  if (isEditableTarget(target)) return;
  if (!synth) return;
  if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
    if (event.repeat) return;
    if (!isTtsActive && !synth.speaking && !currentSpeechMap) return;
    event.preventDefault();
    if (event.key === "ArrowRight") forwardParagraph();
    else rewindParagraph();
    return;
  }
  if (event.code !== "Space" && event.key !== " ") return;
  if (event.repeat) return;
  event.preventDefault();
  if (ui.$resumeButton.is(":visible")) {
    resume();
    return;
  }
  if (synth.speaking) pause();
});
ui.$fileToUpload.on("change", function () {
  let selectedFile = ui.$fileToUpload.get(0).files[0];
  if (!selectedFile) return;
  if (["application/pdf"].indexOf(selectedFile.type) == -1) {
    alert("Error : Not a PDF");
    return;
  }
  setAppMode("viewer");
  showPDF(URL.createObjectURL(selectedFile));
});

function resume() {
  ui.$resumeButton.hide();
  ui.$pauseButton.show();
  synth.resume();
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
  let target =
    document.querySelector(`.page-shell[data-page="${__CURRENT_PAGE}"]`) ||
    document.getElementById("page" + __CURRENT_PAGE);
  if (target) target.scrollIntoView();
}

window.startTextToSpeech = startTextToSpeech;
window.scrollToCurrentPage = scrollToCurrentPage;
window.forwardParagraph = forwardParagraph;
window.rewindParagraph = rewindParagraph;
