import * as CONFIG from "../../config/index.js";

let dialog = null;

export const goLine = {
    showDialog(navigate) {
        if (dialog || !CONFIG.VARS.FILE_CONTENT_CHUNKS.length) return;

        const previousFocus = document.activeElement;
        const labels = CONFIG.RUNTIME_VARS.STYLE;
        dialog = document.createElement("form");
        dialog.id = "goLineDlg";
        dialog.setAttribute("role", "dialog");
        dialog.setAttribute("aria-labelledby", "go-line-title");
        dialog.innerHTML = `
            <div class="goline-header">
                <span id="go-line-title"></span>
                <button class="close-btn" type="button">✕</button>
            </div>
            <div class="goline-body">
                <input type="text" class="goline-txt" autocomplete="off" />
                <button class="goline-btn" type="submit"></button>
            </div>
        `;

        const input = dialog.querySelector("input");
        const closeButton = dialog.querySelector(".close-btn");
        const submitButton = dialog.querySelector(".goline-btn");
        dialog.querySelector("#go-line-title").textContent = labels.ui_go_line_title;
        closeButton.title = labels.ui_go_line_close;
        closeButton.setAttribute("aria-label", labels.ui_go_line_close);
        input.placeholder = labels.ui_go_line_placeholder;
        input.setAttribute("aria-label", labels.ui_go_line_placeholder);
        submitButton.textContent = labels.ui_go_line_submit;

        const form = dialog;
        const close = () => {
            form.remove();
            dialog = null;
            previousFocus?.focus({ preventScroll: true });
        };

        closeButton.addEventListener("click", close);
        form.addEventListener("keydown", (event) => {
            event.stopPropagation();
            if (event.key === "Escape") {
                event.preventDefault();
                close();
            }
        });
        input.addEventListener("input", () => input.setCustomValidity(""));
        form.addEventListener("submit", async (event) => {
            event.preventDefault();
            const value = input.value.normalize("NFKC").trim();
            const lastLine = CONFIG.VARS.FILE_CONTENT_CHUNKS.length - 1;
            const percent = /^(\d+(?:\.\d+)?)\s*%$/.exec(value);
            const line = percent && Number(percent[1]) <= 100
                ? Math.round(Number(percent[1]) * lastLine / 100)
                : /^\d+$/.test(value) ? Number(value) : -1;
            if (line < 0 || line > lastLine) {
                input.setCustomValidity(labels.ui_go_line_invalid);
                input.reportValidity();
                return;
            }
            submitButton.disabled = true;
            try {
                if (await navigate(line) === 0 && dialog === form) close();
            } finally {
                submitButton.disabled = false;
            }
        });

        document.body.appendChild(dialog);
        input.focus();
    },
};
