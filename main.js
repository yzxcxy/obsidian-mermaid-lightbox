const { Modal, Notice, Plugin } = require("obsidian");

class MermaidLightboxModal extends Modal {
  constructor(app, mermaidEl) {
    super(app);
    this.mermaidEl = mermaidEl;
    this.zoom = 1;
    this.minZoom = 0.5;
    this.maxZoom = 6;
    this.zoomFactor = 1.2;
    this.viewportEl = null;
    this.stageEl = null;
    this.zoomBadgeEl = null;
    this.fitButtonEl = null;
    this.clonedSvg = null;
    this.resizeObserver = null;
    this.naturalWidth = 0;
    this.naturalHeight = 0;
    this.onWheelBound = null;
    this.onFitBound = null;
    this.onDoubleClickBound = null;
    this.onMouseDownBound = null;
    this.onMouseMoveBound = null;
    this.onMouseUpBound = null;
    this.isPointerDown = false;
    this.isDragging = false;
    this.dragThreshold = 4;
    this.dragStartX = 0;
    this.dragStartY = 0;
    this.dragScrollLeft = 0;
    this.dragScrollTop = 0;
  }

  onOpen() {
    const { contentEl, modalEl } = this;
    modalEl.addClass("mermaid-lightbox-modal");
    contentEl.empty();

    const headerEl = contentEl.createDiv({ cls: "mermaid-lightbox-header" });
    const titleWrapEl = headerEl.createDiv({ cls: "mermaid-lightbox-title-wrap" });
    titleWrapEl.createDiv({ cls: "mermaid-lightbox-title", text: "Mermaid Diagram Viewer" });
    titleWrapEl.createDiv({
      cls: "mermaid-lightbox-hint",
      text: "Use the mouse wheel to zoom. Press Esc to close."
    });

    const controlsEl = headerEl.createDiv({ cls: "mermaid-lightbox-controls" });
    this.zoomBadgeEl = controlsEl.createDiv({ cls: "mermaid-lightbox-zoom", text: "100%" });
    this.fitButtonEl = controlsEl.createEl("button", {
      cls: "mermaid-lightbox-fit-button",
      text: "Fit"
    });
    this.viewportEl = contentEl.createDiv({ cls: "mermaid-lightbox-viewport" });
    this.stageEl = this.viewportEl.createDiv({ cls: "mermaid-lightbox-stage" });

    const svg = this.mermaidEl.querySelector("svg");
    if (!svg) {
      this.stageEl.createDiv({ cls: "mermaid-lightbox-empty", text: "No Mermaid SVG found." });
      return;
    }

    const size = this.getSvgSize(svg);
    this.naturalWidth = size.width;
    this.naturalHeight = size.height;

    this.clonedSvg = svg.cloneNode(true);
    // Obsidian 1.15's Pele renderer stores its color and font variables on the
    // root SVG. Keep those inline styles when moving the clone into the modal.
    this.clonedSvg.removeAttribute("width");
    this.clonedSvg.removeAttribute("height");
    this.clonedSvg.classList.add("mermaid-lightbox-svg");
    this.stageEl.appendChild(this.clonedSvg);

    this.onWheelBound = this.handleWheel.bind(this);
    this.onFitBound = this.handleFit.bind(this);
    this.onDoubleClickBound = this.handleDoubleClick.bind(this);
    this.onMouseDownBound = this.handleMouseDown.bind(this);
    this.onMouseMoveBound = this.handleMouseMove.bind(this);
    this.onMouseUpBound = this.handleMouseUp.bind(this);
    this.viewportEl.addEventListener("wheel", this.onWheelBound, { passive: false });
    this.stageEl.addEventListener("wheel", this.onWheelBound, { passive: false });
    this.clonedSvg.addEventListener("wheel", this.onWheelBound, { passive: false });
    this.fitButtonEl.addEventListener("click", this.onFitBound);
    this.viewportEl.addEventListener("dblclick", this.onDoubleClickBound);
    this.clonedSvg.addEventListener("dblclick", this.onDoubleClickBound);
    this.viewportEl.addEventListener("mousedown", this.onMouseDownBound);
    document.addEventListener("mousemove", this.onMouseMoveBound);
    document.addEventListener("mouseup", this.onMouseUpBound);

    this.resizeObserver = new ResizeObserver(() => this.render());
    this.resizeObserver.observe(this.viewportEl);

    window.requestAnimationFrame(() => this.render());
  }

  onClose() {
    if (this.viewportEl && this.onWheelBound) {
      this.viewportEl.removeEventListener("wheel", this.onWheelBound);
    }
    if (this.stageEl && this.onWheelBound) {
      this.stageEl.removeEventListener("wheel", this.onWheelBound);
    }
    if (this.clonedSvg && this.onWheelBound) {
      this.clonedSvg.removeEventListener("wheel", this.onWheelBound);
    }
    if (this.fitButtonEl && this.onFitBound) {
      this.fitButtonEl.removeEventListener("click", this.onFitBound);
    }
    if (this.viewportEl && this.onDoubleClickBound) {
      this.viewportEl.removeEventListener("dblclick", this.onDoubleClickBound);
    }
    if (this.clonedSvg && this.onDoubleClickBound) {
      this.clonedSvg.removeEventListener("dblclick", this.onDoubleClickBound);
    }
    if (this.viewportEl && this.onMouseDownBound) {
      this.viewportEl.removeEventListener("mousedown", this.onMouseDownBound);
      this.viewportEl.classList.remove("is-dragging");
    }
    if (this.onMouseMoveBound) {
      document.removeEventListener("mousemove", this.onMouseMoveBound);
    }
    if (this.onMouseUpBound) {
      document.removeEventListener("mouseup", this.onMouseUpBound);
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }

    this.contentEl.empty();
    this.modalEl.removeClass("mermaid-lightbox-modal");
  }

  getSvgSize(svg) {
    const viewBox = svg.viewBox && svg.viewBox.baseVal;
    if (viewBox && viewBox.width > 0 && viewBox.height > 0) {
      return { width: viewBox.width, height: viewBox.height };
    }

    const bbox = typeof svg.getBBox === "function" ? svg.getBBox() : null;
    if (bbox && bbox.width > 0 && bbox.height > 0) {
      return { width: bbox.width, height: bbox.height };
    }

    const rect = svg.getBoundingClientRect();
    return {
      width: Math.max(rect.width, 100),
      height: Math.max(rect.height, 100)
    };
  }

  getFitScale() {
    if (!this.viewportEl || !this.naturalWidth || !this.naturalHeight) {
      return 1;
    }

    const padding = 24;
    const availableWidth = Math.max(this.viewportEl.clientWidth - padding, 1);
    const availableHeight = Math.max(this.viewportEl.clientHeight - padding, 1);
    return Math.min(availableWidth / this.naturalWidth, availableHeight / this.naturalHeight);
  }

  render() {
    if (!this.viewportEl || !this.stageEl || !this.clonedSvg) return;

    const fitScale = this.getFitScale();
    const scale = fitScale * this.zoom;
    const width = Math.max(this.naturalWidth * scale, 1);
    const height = Math.max(this.naturalHeight * scale, 1);

    this.clonedSvg.style.width = `${width}px`;
    this.clonedSvg.style.height = `${height}px`;
    this.stageEl.style.width = `${Math.max(width, this.viewportEl.clientWidth)}px`;
    this.stageEl.style.height = `${Math.max(height, this.viewportEl.clientHeight)}px`;

    if (this.zoomBadgeEl) {
      this.zoomBadgeEl.textContent = `${Math.round(this.zoom * 100)}%`;
    }
  }

  handleWheel(event) {
    if (!this.viewportEl || !this.clonedSvg) return;

    event.preventDefault();
    event.stopPropagation();

    const previousZoom = this.zoom;
    const nextZoom = event.deltaY < 0
      ? Math.min(this.maxZoom, previousZoom * this.zoomFactor)
      : Math.max(this.minZoom, previousZoom / this.zoomFactor);

    if (Math.abs(nextZoom - previousZoom) < 0.0001) return;

    const viewportRect = this.viewportEl.getBoundingClientRect();
    const previousWidth = this.clonedSvg.getBoundingClientRect().width || 1;
    const previousHeight = this.clonedSvg.getBoundingClientRect().height || 1;
    const pointerX = event.clientX - viewportRect.left + this.viewportEl.scrollLeft;
    const pointerY = event.clientY - viewportRect.top + this.viewportEl.scrollTop;
    const anchorX = pointerX / previousWidth;
    const anchorY = pointerY / previousHeight;

    this.zoom = nextZoom;
    this.render();

    const nextWidth = this.clonedSvg.getBoundingClientRect().width || 1;
    const nextHeight = this.clonedSvg.getBoundingClientRect().height || 1;
    this.viewportEl.scrollLeft = anchorX * nextWidth - (event.clientX - viewportRect.left);
    this.viewportEl.scrollTop = anchorY * nextHeight - (event.clientY - viewportRect.top);
  }

  handleFit(event) {
    if (!this.viewportEl) return;
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }

    this.zoom = 1;
    this.render();
    this.viewportEl.scrollLeft = 0;
    this.viewportEl.scrollTop = 0;
  }

  handleDoubleClick(event) {
    this.handleFit(event);
  }

  canPan() {
    return this.zoom > 1.001;
  }

  handleMouseDown(event) {
    if (!this.viewportEl || event.button !== 0 || !this.canPan()) return;

    this.isPointerDown = true;
    this.isDragging = false;
    this.dragStartX = event.clientX;
    this.dragStartY = event.clientY;
    this.dragScrollLeft = this.viewportEl.scrollLeft;
    this.dragScrollTop = this.viewportEl.scrollTop;
  }

  handleMouseMove(event) {
    if (!this.viewportEl || !this.isPointerDown || !this.canPan()) return;

    const deltaX = event.clientX - this.dragStartX;
    const deltaY = event.clientY - this.dragStartY;

    if (!this.isDragging) {
      if (Math.abs(deltaX) < this.dragThreshold && Math.abs(deltaY) < this.dragThreshold) {
        return;
      }
      this.isDragging = true;
      this.viewportEl.classList.add("is-dragging");
    }

    this.viewportEl.scrollLeft = this.dragScrollLeft - deltaX;
    this.viewportEl.scrollTop = this.dragScrollTop - deltaY;
    event.preventDefault();
  }

  handleMouseUp() {
    if (!this.viewportEl) return;

    this.isPointerDown = false;
    this.isDragging = false;
    this.viewportEl.classList.remove("is-dragging");
  }
}

class MermaidLightboxPlugin extends Plugin {
  async onload() {
    this.registerDomEvent(document, "click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const mermaidEl = this.findMermaidElement(target);
      if (!mermaidEl) return;
      if (!mermaidEl.querySelector("svg")) return;

      event.preventDefault();
      event.stopPropagation();
      new MermaidLightboxModal(this.app, mermaidEl).open();
    }, true);

    new Notice("Mermaid Lightbox loaded: Wheel Zoom v2");
  }

  findMermaidElement(target) {
    const directMermaid = target.closest(".mermaid");
    if (directMermaid instanceof HTMLElement) {
      return directMermaid;
    }

    const mermaidBlock = target.closest(".block-language-mermaid, .cm-embed-block, .internal-embed");
    if (!(mermaidBlock instanceof HTMLElement)) {
      return null;
    }

    const nestedMermaid = mermaidBlock.querySelector(".mermaid");
    return nestedMermaid instanceof HTMLElement ? nestedMermaid : null;
  }
}

module.exports = MermaidLightboxPlugin;
module.exports.default = MermaidLightboxPlugin;
