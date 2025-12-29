class TouchSlider {
    constructor(selector, options = {}) {
        this.container = document.querySelector(selector);
        if (!this.container) {
            console.error(`Slider container not found: ${selector}`);
            return;
        }
        this.wrapper = this.container.querySelector('.slider-wrapper');
        if (!this.wrapper) {
            console.error('Slider wrapper not found');
            return;
        }

        // Options
        this.options = {
            freeMode: options.freeMode !== undefined ? options.freeMode : false,
            centered: options.centered !== undefined ? options.centered : true, // Center slides by default
            friction: options.friction || 0.95, // Inertia friction
            angleThreshold: options.angleThreshold || 65, // Degrees - restored to 65 as requested
            speed: options.speed || 300, // ms for snap animation
            resistanceRatio: 0.5, // Resistance when pulling out of bounds
            springK: 0.03, // Very soft spring for "pillow" effect
            springDamping: 0.95, // High damping to prevent bounce
            ...options
        };

        // State
        this.state = {
            isDragging: false,
            startTouchX: 0,
            startTouchY: 0,
            currentTranslate: 0,
            startTranslate: 0,
            startTime: 0,
            isHorizontal: null, // null = unknown, true = horizontal, false = vertical
            rafId: null,
            velocity: 0,
            positions: [] // For velocity calculation: {x, time}
        };

        // Cache dimensions
        this.slides = [];
        this.slidesGrid = [];
        this.wrapperWidth = 0;
        this.containerWidth = 0;
        this.maxTranslate = 0;
        this.minTranslate = 0;

        this.init();
    }

    init() {
        this.updateDimensions();
        this.attachEvents();
        
        // Initial positioning - snap to first slide
        if (this.slidesGrid.length > 0) {
            this.setTranslate(this.slidesGrid[0]);
        } else {
            this.setTranslate(0);
        }
        
        // Resize observer
        window.addEventListener('resize', () => {
            this.updateDimensions();
            // Re-snap to nearest to keep alignment
            this.snapToNearest();
        });
    }

    updateDimensions() {
        const containerRect = this.container.getBoundingClientRect();
        this.containerWidth = containerRect.width;
        
        const wrapperRect = this.wrapper.getBoundingClientRect();
        // Calculate wrapper offset relative to container (e.g. due to padding)
        // CRITICAL: wrapperRect.left includes the current transform!
        // We must subtract currentTranslate to get the static layout offset.
        const wrapperOffset = (wrapperRect.left - containerRect.left) - this.state.currentTranslate;
        
        this.slides = Array.from(this.wrapper.children);
        this.slidesGrid = [];
        
        if (this.slides.length === 0) return;

        this.slides.forEach(slide => {
            const slideRect = slide.getBoundingClientRect();
            const slideWidth = slideRect.width;
            // Calculate position relative to wrapper
            // Both rects are transformed, so the difference is stable (static position)
            const slideLeft = slideRect.left - wrapperRect.left;
            
            if (this.options.centered) {
                // Center the slide in the CONTAINER
                // Target Visual Position = (containerWidth - slideWidth) / 2
                // Visual Position = wrapperOffset + translate + slideLeft
                // translate = Target - slideLeft - wrapperOffset
                const targetPos = (this.containerWidth - slideWidth) / 2;
                this.slidesGrid.push(targetPos - slideLeft - wrapperOffset);
            } else {
                // Left align (standard scrolling)
                this.slidesGrid.push(-slideLeft);
            }
        });

        // Calculate total wrapper width including last slide's margin
        const lastSlide = this.slides[this.slides.length - 1];
        const lastSlideRect = lastSlide.getBoundingClientRect();
        const lastSlideLeft = lastSlideRect.left - wrapperRect.left;
        const lastSlideMargin = this.getMarginRight(lastSlide);
        
        this.wrapperWidth = lastSlideLeft + lastSlideRect.width + lastSlideMargin;
        
        // Bounds
        if (this.options.centered) {
            this.minTranslate = this.slidesGrid[0]; // First slide position
            this.maxTranslate = this.slidesGrid[this.slidesGrid.length - 1]; // Last slide position
        } else {
            // Standard scrolling bounds
            // We use the first slide's position as the start (usually 0 or offset)
            this.minTranslate = this.slidesGrid[0];
            
            // For the end, we want the right edge of the content to align with the right edge of the container.
            // MaxScroll = ContainerWidth - WrapperWidth - WrapperOffset
            const maxScroll = this.containerWidth - this.wrapperWidth - wrapperOffset;
            
            // Ensure we don't scroll past the start if content is small
            this.maxTranslate = Math.min(this.minTranslate, maxScroll);
        }
    }

    getMarginRight(element) {
        const style = window.getComputedStyle(element);
        return parseFloat(style.marginRight) || 0;
    }

    attachEvents() {
        // Passive: false is crucial for preventing default scroll
        this.container.addEventListener('touchstart', this.onTouchStart.bind(this), { passive: false });
        this.container.addEventListener('touchmove', this.onTouchMove.bind(this), { passive: false });
        this.container.addEventListener('touchend', this.onTouchEnd.bind(this));
        this.container.addEventListener('touchcancel', this.onTouchEnd.bind(this));
        
        // Prevent image dragging
        this.wrapper.addEventListener('dragstart', (e) => e.preventDefault());
    }

    onTouchStart(e) {
        // Allow interaction with form elements if needed, but generally we capture everything
        
        if (this.state.rafId) {
            this.stopTransition();
            this.emit('sliderTouchStop'); // Event when stopping movement with touch
        }
        
        const touch = e.touches[0];
        this.state.startTouchX = touch.clientX;
        this.state.startTouchY = touch.clientY;
        this.state.startTime = Date.now();
        
        // Update startTranslate to current position (crucial if we caught it mid-air)
        // We read from state, which should be up to date if we stopped transition
        this.state.startTranslate = this.state.currentTranslate;
        
        this.state.isDragging = true;
        this.state.isHorizontal = null;
        
        // Reset velocity tracking
        this.state.positions = [];
        this.trackVelocity(touch.clientX);

        // Dispatch event: Start of movement
        this.emit('sliderDragStart');
    }

    trackVelocity(x) {
        const now = Date.now();
        this.state.positions.push({ x, time: now });
        // Keep only last 100ms
        this.state.positions = this.state.positions.filter(p => now - p.time < 100);
    }

    calculateVelocity() {
        const positions = this.state.positions;
        if (positions.length < 2) return 0;
        
        const first = positions[0];
        const last = positions[positions.length - 1];
        
        const dt = last.time - first.time;
        if (dt === 0) return 0;
        
        return (last.x - first.x) / dt;
    }

    onTouchMove(e) {
        if (!this.state.isDragging) return;

        const touch = e.touches[0];
        const currentX = touch.clientX;
        const currentY = touch.clientY;
        
        const deltaX = currentX - this.state.startTouchX;
        const deltaY = currentY - this.state.startTouchY;

        // Determine direction if not yet locked
        if (this.state.isHorizontal === null) {
            const absX = Math.abs(deltaX);
            const absY = Math.abs(deltaY);
            
            // Avoid locking on tiny movements
            // Reduced dead zone to 5px to catch the gesture BEFORE the browser starts scrolling
            if (absX < 5 && absY < 5) return;

            // Angle calculation
            const angleRad = Math.atan2(absY, absX);
            const angleDeg = angleRad * 180 / Math.PI;

            // User requirement: "almost -80 to +80" is horizontal.
            // This means if angle is < 80, we treat as horizontal.
            // If angle is >= 80, we treat as vertical.
            if (angleDeg < this.options.angleThreshold) {
                this.state.isHorizontal = true;
            } else {
                this.state.isHorizontal = false;
                this.state.isDragging = false; // Stop tracking this gesture immediately
                return; // Let browser handle vertical scroll
            }
        }

        if (this.state.isHorizontal) {
            // Prevent native vertical scroll
            // CRITICAL: If the event is not cancelable, it means the browser has already started scrolling.
            // In that case, we MUST NOT move the slider, otherwise we get "double scrolling".
            if (e.cancelable) {
                e.preventDefault();
            } else {
                return;
            }

            let translate = this.state.startTranslate + deltaX;

            // Resistance at edges
            if (translate > this.minTranslate) {
                const overscroll = translate - this.minTranslate;
                // Even softer resistance (0.25) allows pulling further
                translate = this.minTranslate + overscroll * 0.25; 
            } else if (translate < this.maxTranslate) {
                const overscroll = this.maxTranslate - translate;
                translate = this.maxTranslate - overscroll * 0.25;
            }

            this.setTranslate(translate);
            this.trackVelocity(currentX);
            this.emit('sliderMove');
        } else {
            // Vertical scroll - let browser handle it
            // Once we decide it's vertical, we stop tracking for this gesture
            this.state.isDragging = false; 
        }
    }

    onTouchEnd(e) {
        if (!this.state.isDragging) {
            return;
        }
        
        // If we never determined direction (e.g. just a tap), stop here
        if (this.state.isHorizontal === null) {
            this.state.isDragging = false;
            return;
        }
        
        if (this.state.isHorizontal === false) {
            // Should not happen if we set isDragging=false in move, but just in case
            this.state.isDragging = false;
            return;
        }

        this.state.isDragging = false;
        this.emit('sliderDragEnd');

        // If cancelled (e.g. by browser taking over scroll), don't do inertia
        if (e.type === 'touchcancel') {
            this.snapToNearest();
            return;
        }

        // Calculate final velocity
        this.state.velocity = this.calculateVelocity();
        
        // If velocity is very low, treat as 0
        if (Math.abs(this.state.velocity) < 0.05) this.state.velocity = 0;

        // If we are already out of bounds and velocity is low (dragged and released),
        // go straight to the smooth return.
        if ((this.state.currentTranslate > this.minTranslate || this.state.currentTranslate < this.maxTranslate) 
            && Math.abs(this.state.velocity) < 0.1) {
            this.snapToBounds();
            return;
        }

        // Snap Mode: "Magnetic" feel
        // If not freeMode, we skip the inertia loop and go straight to the target slide.
        // We project where the slide would land based on velocity to decide which slide to snap to.
        if (!this.options.freeMode) {
            // Check if we are in bounds (if out of bounds, let startInertia handle the pillow stop)
            if (this.state.currentTranslate <= this.minTranslate && this.state.currentTranslate >= this.maxTranslate) {
                // Project position: current + velocity * factor
                // Factor determines how easy it is to flick to next slide.
                // 200ms worth of velocity is a good baseline.
                const projection = this.state.currentTranslate + (this.state.velocity * 200);
                this.snapToNearest(projection);
                return;
            }
        }

        this.startInertia();
    }

    setTranslate(translate) {
        this.state.currentTranslate = translate;
        this.wrapper.style.transform = `translate3d(${translate}px, 0, 0)`;
        this.checkVisibilityEvents();
    }

    stopTransition() {
        if (this.state.rafId) {
            cancelAnimationFrame(this.state.rafId);
            this.state.rafId = null;
        }
    }

    startInertia() {
        let velocity = this.state.velocity;
        let current = this.state.currentTranslate;
        let lastTime = Date.now();

        const step = () => {
            if (this.state.isDragging) return;

            const now = Date.now();
            const dt = Math.min(now - lastTime, 60); // Cap dt to avoid huge jumps
            lastTime = now;

            // Physics Loop
            let force = 0;
            let isOutOfBounds = false;

            // Check bounds (Rubber Band Spring)
            if (current > this.minTranslate || current < this.maxTranslate) {
                isOutOfBounds = true;
            }

            if (isOutOfBounds) {
                // "Pillow" logic:
                // Instead of a spring force that bounces back, we just apply heavy friction
                // to stop the movement. Once stopped, we trigger a smooth return animation.
                
                velocity *= 0.6; // Very heavy friction (stops almost instantly)
                
                // If effectively stopped, trigger the smooth return
                if (Math.abs(velocity) < 0.1) {
                    this.snapToBounds();
                    return; // Stop the physics loop
                }
            } else {
                // Normal Inertia
                velocity *= this.options.friction;
                
                // Stop if slow
                if (Math.abs(velocity) < 0.01) {
                    if (this.options.freeMode) {
                        this.emit('sliderStop');
                        return;
                    } else {
                        // Snap mode: find nearest and animate there
                        this.snapToNearest();
                        return;
                    }
                }
            }

            current += velocity * dt;
            this.setTranslate(current);
            this.state.rafId = requestAnimationFrame(step);
        };

        this.state.rafId = requestAnimationFrame(step);
    }

    snapToNearest(targetPosition = null) {
        // Find closest slide position
        // If targetPosition is provided (e.g. from velocity projection), use it.
        // Otherwise use current position.
        const searchPos = targetPosition !== null ? targetPosition : this.state.currentTranslate;
        
        let closest = this.slidesGrid[0];
        let minDiff = Math.abs(searchPos - closest);
        let closestIndex = 0;

        for (let i = 1; i < this.slidesGrid.length; i++) {
            const pos = this.slidesGrid[i];
            const diff = Math.abs(searchPos - pos);
            if (diff < minDiff) {
                minDiff = diff;
                closest = pos;
                closestIndex = i;
            }
        }
        
        // Clamp to bounds
        if (closest > this.minTranslate) closest = this.minTranslate;
        if (closest < this.maxTranslate) closest = this.maxTranslate;

        this.animateTo(closest, {
            duration: 500, // Slightly slower for smoothness
            easing: (t) => 1 - Math.pow(1 - t, 4), // easeOutQuart (softer than Cubic)
            callback: () => {
                this.emit('slideChange', { index: closestIndex });
            }
        });
    }

    snapToBounds() {
        let target = this.state.currentTranslate;
        if (target > this.minTranslate) target = this.minTranslate;
        else if (target < this.maxTranslate) target = this.maxTranslate;
        else return; // Not out of bounds

        // "Pillow" return: Slower duration and smoother easing
        this.animateTo(target, {
            duration: 700, // Even slower for "pillow" feel
            easing: (t) => 1 - Math.pow(1 - t, 4) // easeOutQuart (very soft)
        });
    }

    animateTo(target, options = {}) {
        const start = this.state.currentTranslate;
        const distance = target - start;
        const startTime = Date.now();
        const duration = options.duration || this.options.speed;
        const easing = options.easing || ((t) => t * (2 - t)); // Default easeOutQuad
        const callback = options.callback;

        const loop = () => {
            // If user interrupts animation, stop
            if (this.state.isDragging) return;

            const now = Date.now();
            const elapsed = now - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const ease = easing(progress);

            const newPos = start + (distance * ease);
            this.setTranslate(newPos);

            if (progress < 1) {
                this.state.rafId = requestAnimationFrame(loop);
            } else {
                this.emit('sliderStop');
                if (callback) callback();
            }
        };

        this.stopTransition();
        this.state.rafId = requestAnimationFrame(loop);
    }

    checkVisibilityEvents() {
        if (this.slides.length === 0) return;
        
        const lastSlide = this.slides[this.slides.length - 1];
        const sliderRect = this.container.getBoundingClientRect();
        const slideRect = lastSlide.getBoundingClientRect();
        
        // Check intersection
        const x1 = Math.max(sliderRect.left, slideRect.left);
        const x2 = Math.min(sliderRect.right, slideRect.right);
        
        if (x1 < x2) {
            // Visible
            const visibleWidth = x2 - x1;
            const ratio = visibleWidth / slideRect.width;
            
            this.emit('lastSlideVisibility', {
                visible: true,
                intersectionRatio: ratio,
                isFullyVisible: ratio >= 0.99
            });
        }
    }

    emit(name, detail = {}) {
        const event = new CustomEvent(name, { detail });
        this.container.dispatchEvent(event);
    }
}

// Export for usage
window.TouchSlider = TouchSlider;
