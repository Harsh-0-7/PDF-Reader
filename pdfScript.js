const synth = window.speechSynthesis;
const utterance = new SpeechSynthesisUtterance();
let __PDF_DOC;
let __CURRENT_PAGE = 1;
let __TOTAL_PAGES;
let __PAGE_RENDERING_IN_PROGRESS = 0;

const CANVAS_WIDTH = 1000;
const voiceSelectEl = document.getElementById("voiceSelect");
const pdfContainerEl = document.getElementById("pdfContainer");

function scroll() {
  document.getElementById("textLayer" + __CURRENT_PAGE).scrollIntoView();
  console.log(document.getElementById("textLayer" + __CURRENT_PAGE));
}
function populateVoiceList() {
  if (!synth) return;

  const voices = synth.getVoices();
  voices.forEach((voice) => {
    const option = document.createElement("option");
    option.textContent = `${voice.name} (${voice.lang})${
      voice.default ? " — DEFAULT" : ""
    }`;
    option.setAttribute("data-lang", voice.lang);
    option.setAttribute("data-name", voice.name);
    voiceSelectEl.appendChild(option);
  });
}
if (synth?.onvoiceschanged !== undefined) {
  synth.onvoiceschanged = populateVoiceList;
}
function getSelectedVoice() {
  const voices = synth.getVoices();
  return voices[voiceSelectEl.selectedIndex];
}

function startTextToSpeech(startWord) {
  if (synth.speaking) {
    synth.cancel();
  }

  const selectedVoice = getSelectedVoice();
  if (selectedVoice) {
    utterance.voice = selectedVoice;
  }

  __PDF_DOC
    .getPage(__CURRENT_PAGE)
    .then((page) => {
      return page.getTextContent();
    })
    .then((content) => {
      const textContent = content.items.map((item) => item.str).join(" ");
      utterance.text = refineText(
        startWord
          ? textContent.slice(textContent.indexOf(startWord))
          : textContent
      );

      utterance.onend = function () {
        if (__CURRENT_PAGE != __TOTAL_PAGES) {
          __CURRENT_PAGE++;
          startTextToSpeech();
          scroll();
        }
      };

      synth.speak(utterance);
      resume();
    })
    .catch(console.log);
}

function showPDF(pdfUrl) {
  $("#pdf-loader").show();

  PDFJS.getDocument({ url: pdfUrl })
    .then((pdfDoc) => {
      __PDF_DOC = pdfDoc;
      __TOTAL_PAGES = pdfDoc.numPages;

      $("#pdf-loader").hide();
      $("#pdf-contents").show();
      $("#pdf-total-pages").text(__TOTAL_PAGES);

      for (let i = 1; i <= __TOTAL_PAGES; i++) {
        createPageElements(i);
      }
    })
    .catch((error) => {
      $("#pdf-loader").hide();
      $("#upload-button").show();
      alert(error.message);
    });
}

function createPageElements(pageNumber) {
  const canvas = createCanvas(pageNumber);
  const textLayer = createTextLayer(pageNumber);

  pdfContainerEl.appendChild(canvas);
  pdfContainerEl.appendChild(textLayer);

  showPage(pageNumber, canvas, canvas.getContext("2d"));

  $(textLayer).on("click", "div", function () {
    handleWordClick(pageNumber, $(this));
  });
}

function createCanvas(pageNumber) {
  const canvas = document.createElement("canvas");
  canvas.id = `page${pageNumber}`;
  canvas.width = CANVAS_WIDTH;
  canvas.classList.add("canvas");
  return canvas;
}

function createTextLayer(pageNumber) {
  const textLayer = document.createElement("div");
  textLayer.id = `textLayer${pageNumber}`;
  textLayer.classList.add("textLayer");
  return textLayer;
}

function handleWordClick(pageNumber, clickedElement) {
  if (synth.speaking) {
    synth.cancel();
  }

  const clickedWord = clickedElement.text().trim();
  const nextPageWords = clickedElement
    .nextAll("div")
    .map(function () {
      return $(this).text().trim();
    })
    .get()
    .join(" ");

  const selectedVoice = getSelectedVoice();
  if (selectedVoice) {
    utterance.voice = selectedVoice;
  }

  __CURRENT_PAGE = pageNumber;
  utterance.text = refineText(`${clickedWord} ${nextPageWords}`);

  utterance.onend = function () {
    if (__CURRENT_PAGE != __TOTAL_PAGES) {
      __CURRENT_PAGE++;
      startTextToSpeech();
      scroll();
    }
  };

  synth.speak(utterance);
  resume();
}

function showPage(page_no, newCanvas, newCtx) {
  __PAGE_RENDERING_IN_PROGRESS = 1;

  // Disable Prev & Next buttons while page is being loaded
  $("#pdf-next, #pdf-prev").attr("disabled", "disabled");

  // While page is being rendered hide the canvas and show a loading message
  $("#pdf-canvas").hide();
  $("#page-loader").show();

  // Update current page in HTML
  // $("#pdf-current-page").text(page_no);

  // Fetch the page
  __PDF_DOC.getPage(page_no).then(function (page) {
    // As the canvas is of a fixed width we need to set the scale of the viewport accordingly
    let scale_required = newCanvas.width / page.getViewport(1).width;

    // Get viewport of the page at required scale
    let viewport = page.getViewport(scale_required);
    // Set canvas height
    newCanvas.height = viewport.height;
    let renderContext = {
      canvasContext: newCtx,
      viewport: viewport,
    };

    // Render the page contents in the canvas
    page
      .render(renderContext)
      .then(function () {
        __PAGE_RENDERING_IN_PROGRESS = 0;

        // Re-enable Prev & Next buttons
        $("#pdf-next, #pdf-prev").removeAttr("disabled");

        // Show the canvas and hide the page loader
        $("#pdf-canvas").show();
        $("#page-loader").hide();

        // Return the text contents of the page after the pdf has been rendered in the canvas
        return page.getTextContent();
      })
      .then(function (textContent) {
        // Get canvas offset
        let canvas_offset = $(`#page${page_no}`).offset();

        // Assign the CSS created to the text-layer element
        $(`#textLayer${page_no}`).css({
          left: canvas_offset.left + "px",
          top: canvas_offset.top + "px",
          height: newCanvas.height + "px",
          width: newCanvas.width + "px",
        });
        // Pass the data to the method for rendering of text over the pdf canvas.
        // console.log($("#text-layer").get(1));
        PDFJS.renderTextLayer({
          textContent: textContent,
          container: $(`#textLayer${page_no}`).get(0),
          viewport: viewport,
          textDivs: [],
        });
      })
      .then(function () {
        const currentPageElement = document.getElementById("pdf-current-page");
        const pageHeight = parseInt(
          $("#page1")
            .css("height")
            .substring(0, $("#page1").css("height").length - 2)
        );
        $(window).scroll(function () {
          const scrollTop = window.scrollY;
          const currentPage = Math.floor(scrollTop / pageHeight) + 1;
          currentPageElement.textContent = currentPage;
        });
      });
  });
}

// Upon click this should should trigger click on the #file-to-upload file input element
// This is better than showing the not-good-looking file input element
$("#upload-button").on("click", function () {
  $("#file-to-upload").trigger("click");
  $("#pause-button").hide();
  $("#resume-button").hide();
});

$("#file-to-upload").on("change", function () {
  const file = $("#file-to-upload").get(0).files[0];
  if (file.type !== "application/pdf") {
    alert("Error: Not a PDF");
    return;
  }

  $("#upload-button").hide();
  showPDF(URL.createObjectURL(file));
});

function refineText(text) {
  return text.replace(/\x00/g, "");
}

function resume() {
  $("#resume-button").hide();
  $("#pause-button").show();
  if (!synth.paused) {
    synth.resume();
  }
}

function pause() {
  $("#pause-button").hide();
  $("#resume-button").show();
  if (synth.speaking) {
    synth.pause();
  }
}

window.onbeforeunload = function () {
  synth.cancel();
};
