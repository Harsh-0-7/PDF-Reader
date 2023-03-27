let synth = window.speechSynthesis;
let utterance = new SpeechSynthesisUtterance();
let __PDF_DOC,
	__CURRENT_PAGE = 1,
	__TOTAL_PAGES,
	__PAGE_RENDERING_IN_PROGRESS = 0;

let canvas_width = 1000;

function scroll() {
	document.getElementById("textLayer" + __CURRENT_PAGE).scrollIntoView();
	console.log(document.getElementById("textLayer" + __CURRENT_PAGE));
}
function populateVoiceList() {
	if (typeof synth === "undefined") {
		return;
	}

	const voices = synth.getVoices();

	for (const element of voices) {
		const option = document.createElement("option");
		option.textContent = `${element.name} (${element.lang})`;

		if (element.default) {
			option.textContent += " — DEFAULT";
		}

		option.setAttribute("data-lang", element.lang);
		option.setAttribute("data-name", element.name);
		document.getElementById("voiceSelect").appendChild(option);
	}
}
if (typeof synth !== "undefined" && synth.onvoiceschanged !== undefined) {
	synth.onvoiceschanged = populateVoiceList;
}
function startTextToSpeech(startWord, viewport) {
	if (synth.speaking) {
		synth.cancel();
	}
	let voices = synth.getVoices();

	let selectedVoice =
		voices[document.getElementById("voiceSelect").selectedIndex];
	if (selectedVoice !== null) {
		utterance.voice = selectedVoice;
	}
	let textContent = "";
	__PDF_DOC
		.getPage(__CURRENT_PAGE)
		.then(function (page) {
			return page.getTextContent();
		})
		.then(function (content) {
			textContent = content.items
				.map(function (item) {
					return item.str;
				})
				.join(" ");
			if (startWord) {
				let startIndex = textContent.indexOf(startWord);
				utterance.text = refineText(textContent.slice(startIndex));
			} else {
				utterance.text = refineText(textContent);
			}
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
		.catch(function (error) {
			console.log(error);
		});
}

function showPDF(pdf_url) {
	$("#pdf-loader").show();

	PDFJS.getDocument({ url: pdf_url })
		.then(function (pdf_doc) {
			__PDF_DOC = pdf_doc;
			__TOTAL_PAGES = __PDF_DOC.numPages;

			// Hide the pdf loader and show pdf container in HTML
			$("#pdf-loader").hide();
			$("#pdf-contents").show();
			$("#pdf-total-pages").text(__TOTAL_PAGES);
			let canvas, textLayer;
			for (let i = 1; i <= __TOTAL_PAGES; i++) {
				canvas = document.createElement("canvas");
				canvas.id = "page" + i;
				canvas.width = canvas_width;
				textLayer = document.createElement("div");
				textLayer.id = "textLayer" + i;
				canvas.classList.add("canvas");
				textLayer.classList.add("textLayer");

				document.getElementById("pdfContainer").appendChild(canvas);
				document.getElementById("pdfContainer").appendChild(textLayer);

				showPage(i, canvas, canvas.getContext("2d"));
				// Add click event listeners to each word in the text layer
				$("#textLayer" + i).on("click", "div", function () {
					// Get the clicked word's text content
					__CURRENT_PAGE = i;
					const clickedWord = $(this).text().trim();
					// Get the text content of the rest of the page
					const nextPageWords = $(this)
						.nextAll("div")
						.map(function () {
							return $(this).text().trim();
						})
						.get()
						.join(" ");
					// Set the text to the utterance
					if (synth.speaking) {
						synth.cancel();
					}
					let voices = synth.getVoices();

					let selectedVoice =
						voices[document.getElementById("voiceSelect").selectedIndex];
					if (selectedVoice !== null) {
						utterance.voice = selectedVoice;
					}

					utterance.text = refineText(clickedWord + " " + nextPageWords);
					// Start the text-to-speech feature
					utterance.onend = function () {
						if (__CURRENT_PAGE != __TOTAL_PAGES) {
							__CURRENT_PAGE++;
							startTextToSpeech();
							scroll();
						}
					};
					synth.speak(utterance);
					resume();
				});
			}
		})
		.catch(function (error) {
			// If error re-show the upload button
			$("#pdf-loader").hide();
			$("#upload-button").show();

			alert(error.message);
		});
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

// When user chooses a PDF file
$("#file-to-upload").on("change", function () {
	// Validate whether PDF
	if (
		["application/pdf"].indexOf($("#file-to-upload").get(0).files[0].type) == -1
	) {
		alert("Error : Not a PDF");
		return;
	}

	$("#upload-button").hide();

	// Send the object url of the pdf
	showPDF(URL.createObjectURL($("#file-to-upload").get(0).files[0]));
});

function resume() {
	$("#resume-button").hide();
	$("#pause-button").show();
	if (!synth.paused) synth.resume();
}

function pause() {
	$("#pause-button").hide();
	$("#resume-button").show();
	if (synth.speaking) synth.pause();
}

window.onbeforeunload = function () {
	synth.cancel();
};

function refineText(text) {
	let newText = text.replace(/\x00/g, "");
	return newText;
}
