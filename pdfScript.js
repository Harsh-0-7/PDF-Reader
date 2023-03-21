let synth = window.speechSynthesis;
let utterance = new SpeechSynthesisUtterance();
let __PDF_DOC,
	__CURRENT_PAGE,
	__TOTAL_PAGES,
	__PAGE_RENDERING_IN_PROGRESS = 0,
	__CANVAS = $("#pdf-canvas").get(0),
	__CANVAS_CTX = __CANVAS.getContext("2d");

// function highlightWord(word, viewport) {
// 	console.log(word, viewport);
// 	let textDivs = document.querySelectorAll(".textLayer > div");
// 	for (const element of textDivs) {
// 		let textDiv = element;
// 		if (textDiv.textContent.trim() === word.trim()) {
// 			textDiv.classList.add("highlight");
// 			scrollIntoView(textDiv, viewport);
// 		} else {
// 			textDiv.classList.remove("highlight");
// 		}
// 	}
// }
function highlightWord(wordId, viewport) {
	let textDiv = document.getElementById(wordId);
	if (textDiv) {
		// console.log("Added", wordId, textDiv);
		textDiv.classList.add("highlight");
		// scrollIntoView(textDiv, viewport);
	} else {
		// console.log("not found", wordId);
	}
}
function startTextToSpeech(startWord, viewport) {
	if (synth.speaking) {
		synth.cancel();
	}

	// let textDivs = document.querySelectorAll("#text-layer > div");
	// console.log(textDivs);
	// // let charcount = 0;
	// for (let i = 0; i < textDivs.length; i++) {
	// 	textDivs[i].id = `text-${__CURRENT_PAGE}-${i}`;
	// 	// charcount += element.innerHTML.length;
	// }
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
				utterance.text = textContent.slice(startIndex);
			} else {
				utterance.text = textContent;
			}
			synth.speak(utterance);
			utterance.onboundary = function (event) {
				// console.log(event);
				// let word = event.target.text.slice(
				// 	event.charIndex,
				// 	event.charIndex + event.charLength
				// );
				let wordId = `text-${__CURRENT_PAGE}-${event.charIndex}`;
				// console.log(wordId);
				// highlightWord(wordId, viewport);
			};
			resume();
		})
		.catch(function (error) {
			console.log(error);
		});
}
function showPDF(pdf_url) {
	$("#pdf-loader").show();

	let loadingTask = PDFJS.getDocument({ url: pdf_url })
		.then(function (pdf_doc) {
			__PDF_DOC = pdf_doc;
			__TOTAL_PAGES = __PDF_DOC.numPages;

			// Hide the pdf loader and show pdf container in HTML
			$("#pdf-loader").hide();
			$("#pdf-contents").show();
			$("#pdf-total-pages").text(__TOTAL_PAGES);

			// Show the first page
			showPage(1);

			// Add click event listeners to each word in the text layer
			$("#text-layer").on("click", "div", function () {
				// Get the clicked word's text content
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
				utterance.text = clickedWord + " " + nextPageWords;
				// Start the text-to-speech feature
				synth.speak(utterance);
				resume();
			});
		})
		.catch(function (error) {
			// If error re-show the upload button
			$("#pdf-loader").hide();
			$("#upload-button").show();

			alert(error.message);
		});

	loadingTask.onProgress = function (progress) {
		let percent_loaded = (progress.loaded / progress.total) * 100;
	};
}

function showPage(page_no) {
	__PAGE_RENDERING_IN_PROGRESS = 1;
	__CURRENT_PAGE = page_no;

	// Disable Prev & Next buttons while page is being loaded
	$("#pdf-next, #pdf-prev").attr("disabled", "disabled");

	// While page is being rendered hide the canvas and show a loading message
	$("#pdf-canvas").hide();
	$("#page-loader").show();

	// Update current page in HTML
	$("#pdf-current-page").text(page_no);

	// Fetch the page
	__PDF_DOC.getPage(page_no).then(function (page) {
		// As the canvas is of a fixed width we need to set the scale of the viewport accordingly
		let scale_required = __CANVAS.width / page.getViewport(1).width;

		// Get viewport of the page at required scale
		let viewport = page.getViewport(scale_required);

		// Set canvas height
		__CANVAS.height = viewport.height;

		let renderContext = {
			canvasContext: __CANVAS_CTX,
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
				let canvas_offset = $("#pdf-canvas").offset();

				// Clear HTML for text layer
				$("#text-layer").html("");

				// Assign the CSS created to the text-layer element
				$("#text-layer").css({
					left: canvas_offset.left + "px",
					top: canvas_offset.top + "px",
					height: __CANVAS.height + "px",
					width: __CANVAS.width + "px",
				});
				// Pass the data to the method for rendering of text over the pdf canvas.
				PDFJS.renderTextLayer({
					textContent: textContent,
					container: $("#text-layer").get(0),
					viewport: viewport,
					textDivs: [],
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

function prevPage() {
	if (__CURRENT_PAGE != 1) {
		showPage(--__CURRENT_PAGE);
	}
}

function nextPage() {
	if (__CURRENT_PAGE != __TOTAL_PAGES) {
		showPage(++__CURRENT_PAGE);
	}
}

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
