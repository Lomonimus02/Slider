/**
 * TouchSlider - горизонтальный слайдер для мобильных устройств
 * 
 * Класс реализует базовую инфраструктуру для создания touch-friendly слайдера
 * с плавной анимацией через transform: translate3d
 */
class TouchSlider {
    /**
     * Конструктор класса
     * @param {string|HTMLElement} element - Селектор или DOM-узел контейнера слайдера
     * @param {Object} options - Объект с настройками слайдера
     */
    constructor(element, options = {}) {
        // Определяем корневой элемент слайдера
        if (typeof element === 'string') {
            this.slider = document.querySelector(element);
        } else if (element instanceof HTMLElement) {
            this.slider = element;
        } else {
            throw new Error('TouchSlider: element должен быть селектором или DOM-узлом');
        }

        // Проверяем, что элемент найден
        if (!this.slider) {
            throw new Error('TouchSlider: элемент не найден');
        }

        // Настройки по умолчанию (Авито-стиль)
        this.options = {
            // Физика (Авито-подобное поведение)
            friction: 0.94,           // Коэффициент трения - плавное затухание (0.9-0.98)
            bounce: 0.12,             // Сила отскока от краев - мягкий (0.05-0.2)
            rubberBandEffect: 0.2,    // Коэффициент сопротивления - упругое (0.2-0.4)
            velocityThreshold: 0.1,   // Минимальная скорость для продолжения инерции
            
            // Режимы движения (Авито = Snap по центру)
            freeMode: false,          // false: snap к слайдам (как Авито)
            snapAlign: 'center',      // 'center': слайд по центру (как Авито)
            snapSpeed: 0.15,          // Скорость довода до слайда (0.05-0.2)
            velocityMultiplier: 1.2,  // Множитель скорости - умеренная инерция
            
            ...options
        };

        /**
         * Объект состояния слайдера
         * @property {number} currentX - Текущая позиция трека по оси X (для анимации)
         * @property {number} targetX - Целевая позиция трека по оси X (куда стремимся)
         * @property {boolean} isDragging - Флаг активного перетаскивания
         * @property {number} sliderWidth - Ширина видимой области слайдера
         * @property {number} trackWidth - Общая ширина трека со всеми слайдами
         */
        this.state = {
            currentX: 0,      // Текущая позиция (будет обновляться в RAF)
            targetX: 0,       // Целевая позиция (куда двигаемся)
            isDragging: false, // Флаг перетаскивания
            sliderWidth: 0,   // Ширина контейнера
            trackWidth: 0,    // Полная ширина трека
            
            // Snap логика
            isSnapping: false,      // Флаг активного snap-движения к слайду
            snapTargetX: 0,         // Целевая позиция для snap
            currentSlideIndex: 0,   // Индекс текущего слайда
            previousSlideIndex: 0,  // Предыдущий индекс (для slideChange)
            
            // Отслеживание последнего слайда
            lastSlideVisibleStart: false,  // Последний слайд начал показываться
            lastSlideVisibleFull: false,   // Последний слайд полностью виден
            previousX: 0            // Предыдущая позиция для sliderMove
        };

        /**
         * Touch-специфичные данные для отслеживания жестов
         */
        this.touch = {
            startX: 0,              // Начальная X координата касания
            startY: 0,              // Начальная Y координата касания
            currentX: 0,            // Текущая X координата касания
            currentY: 0,            // Текущая Y координата касания
            startTime: 0,           // Время начала касания (для расчета скорости)
            startPositionX: 0,      // Позиция трека в момент начала касания
            isTouching: false,      // Флаг: палец на экране (до определения направления)
            isDirectionDetermined: false, // Флаг: определено ли направление свайпа
            isHorizontalSwipe: false,     // Флаг: горизонтальный ли это свайп
            velocityX: 0,           // Текущая скорость движения по X
            history: []             // История позиций за последние 100мс для точного расчета скорости
        };

        /**
         * Данные для анимации (RAF цикл)
         */
        this.animation = {
            rafId: null,            // ID requestAnimationFrame для отмены
            isAnimating: false      // Флаг активной анимации
        };

        /**
         * Хранилище обработчиков событий для API
         * Структура: { eventName: [handler1, handler2, ...] }
         */
        this.eventHandlers = {};

        // Ссылки на DOM-элементы (будут инициализированы в init)
        this.track = null;
        this.slides = null;

        // Привязываем метод animate к контексту для RAF
        this.animate = this.animate.bind(this);

        // Инициализация слайдера
        this.init();
    }

    /**
     * Инициализация слайдера
     * Находит необходимые элементы, вешает слушатели событий, вычисляет размеры
     */
    init() {
        // 1. Находим внутренние элементы
        this.track = this.slider.querySelector('.slider__track');
        
        if (!this.track) {
            throw new Error('TouchSlider: не найден элемент .slider__track');
        }

        this.slides = Array.from(this.track.querySelectorAll('.slider__slide'));

        if (this.slides.length === 0) {
            console.warn('TouchSlider: слайды не найдены');
        }

        // 2. Вычисляем размеры
        this.calculateDimensions();

        // 3. Устанавливаем начальную позицию трека
        this.setTrackPosition(0);

        // 4. Навешиваем слушатели событий (пока заглушки)
        this.attachEventListeners();

        // 5. Подписываемся на изменение размеров окна
        this.handleResize = this.handleResize.bind(this);
        window.addEventListener('resize', this.handleResize);

        console.log('TouchSlider инициализирован', {
            sliderWidth: this.state.sliderWidth,
            trackWidth: this.state.trackWidth,
            slidesCount: this.slides.length
        });
    }

    /**
     * Вычисление размеров слайдера и трека
     */
    calculateDimensions() {
        // Ширина видимой области слайдера
        this.state.sliderWidth = this.slider.offsetWidth;

        // Вычисляем общую ширину трека (сумма ширин всех слайдов)
        this.state.trackWidth = 0;
        this.slides.forEach(slide => {
            this.state.trackWidth += slide.offsetWidth;
        });

        console.log('Размеры пересчитаны:', {
            sliderWidth: this.state.sliderWidth,
            trackWidth: this.state.trackWidth
        });
    }

    /**
     * Установка позиции трека через transform
     * @param {number} x - Позиция по оси X
     */
    setTrackPosition(x) {
        this.state.currentX = x;
        this.state.targetX = x;
        
        // Применяем трансформацию с аппаратным ускорением
        this.track.style.transform = `translate3d(${x}px, 0, 0)`;
    }

    /**
     * Навешивание слушателей событий (пока заглушки)
     */
    attachEventListeners() {
        // Touch события
        this.handleTouchStart = this.handleTouchStart.bind(this);
        this.handleTouchMove = this.handleTouchMove.bind(this);
        this.handleTouchEnd = this.handleTouchEnd.bind(this);

        this.slider.addEventListener('touchstart', this.handleTouchStart, { passive: false });
        this.slider.addEventListener('touchmove', this.handleTouchMove, { passive: false });
        this.slider.addEventListener('touchend', this.handleTouchEnd);
        this.slider.addEventListener('touchcancel', this.handleTouchEnd);

        // Mouse события (для тестирования на desktop)
        this.handleMouseDown = this.handleMouseDown.bind(this);
        this.handleMouseMove = this.handleMouseMove.bind(this);
        this.handleMouseUp = this.handleMouseUp.bind(this);

        this.slider.addEventListener('mousedown', this.handleMouseDown);
        window.addEventListener('mousemove', this.handleMouseMove);
        window.addEventListener('mouseup', this.handleMouseUp);

        console.log('Слушатели событий навешаны (заглушки)');
    }

    /**
     * Обработчик начала касания (touchstart)
     * Запоминаем начальные координаты, время и позицию трека
     * НЕ устанавливаем isDragging - это произойдет только после определения направления
     */
    handleTouchStart(e) {
        const touch = e.touches[0];
        
        // Запоминаем начальные координаты касания
        this.touch.startX = touch.clientX;
        this.touch.startY = touch.clientY;
        this.touch.currentX = touch.clientX;
        this.touch.currentY = touch.clientY;
        
        // Запоминаем время начала касания (для будущего расчета скорости)
        this.touch.startTime = Date.now();
        
        // Запоминаем текущую позицию трека в момент начала касания
        this.touch.startPositionX = this.state.currentX;
        
        // Сбрасываем флаги направления (они будут определены при первом движении)
        this.touch.isDirectionDetermined = false;
        this.touch.isHorizontalSwipe = false;
        
        // Флаг что касание активно (но направление еще не определено)
        this.touch.isTouching = true;
        
        // НЕ останавливаем snap анимацию сразу!
        // Остановим только если определим горизонтальный свайп
        // Это позволяет скроллить вертикально во время snap анимации
        
        // Обнуляем скорость для инерции
        this.touch.velocityX = 0;
        
        // Очищаем историю позиций для нового жеста
        this.touch.history = [];
        
        // Добавляем первую точку в историю
        this.touch.history.push({
            x: this.state.currentX,
            time: Date.now()
        });
        
        // НЕ устанавливаем isDragging здесь!
        // isDragging будет установлен только когда определим горизонтальный свайп
    }

    handleTouchMove(e) {
        // Если касание не активно, ничего не делаем
        if (!this.touch.isTouching) {
            return;
        }
        
        const touch = e.touches[0];
        
        // Сохраняем предыдущие координаты для расчета дельты движения
        const prevX = this.touch.currentX;
        const prevY = this.touch.currentY;
        
        // Обновляем текущие координаты
        this.touch.currentX = touch.clientX;
        this.touch.currentY = touch.clientY;
        
        // Вычисляем дельту от НАЧАЛА касания (для определения направления)
        const deltaX = this.touch.currentX - this.touch.startX;
        const deltaY = this.touch.currentY - this.touch.startY;
        
        // Вычисляем дельту движения в ЭТОМ кадре (для скролла)
        const frameDeltaY = this.touch.currentY - prevY;
        
        /**
         * ОПРЕДЕЛЕНИЕ НАПРАВЛЕНИЯ СВАЙПА
         * 
         * Используем увеличенный порог (10px) для надежного определения.
         * Угол допуска: ±80 градусов относительно горизонтальной оси.
         * tan(80°) ≈ 5.6713
         */
        if (!this.touch.isDirectionDetermined) {
            const threshold = 10; // Увеличенный порог для надежности
            const absDeltaX = Math.abs(deltaX);
            const absDeltaY = Math.abs(deltaY);
            
            // Проверяем достигнут ли порог хотя бы по одной оси
            if (absDeltaX > threshold || absDeltaY > threshold) {
                this.touch.isDirectionDetermined = true;
                
                // tan(80°) ≈ 5.6713 - если deltaY/deltaX < 5.67, это горизонтальный свайп
                const tan80deg = 5.6713;
                
                if (absDeltaX === 0) {
                    // Чисто вертикальное движение
                    this.touch.isHorizontalSwipe = false;
                } else {
                    const ratio = absDeltaY / absDeltaX;
                    this.touch.isHorizontalSwipe = ratio < tan80deg;
                }
                
                // Если горизонтальный свайп - активируем режим перетаскивания слайдера
                if (this.touch.isHorizontalSwipe) {
                    // ТЕПЕРЬ останавливаем анимацию (только при горизонтальном свайпе)
                    if (this.animation.rafId) {
                        cancelAnimationFrame(this.animation.rafId);
                        this.animation.rafId = null;
                        this.animation.isAnimating = false;
                        
                        // Генерируем событие manualStop
                        this.dispatchEvent('manualStop', {
                            position: this.state.currentX,
                            velocity: this.touch.velocityX
                        });
                    }
                    this.state.isSnapping = false;
                    
                    // Обновляем начальную позицию трека на текущую
                    this.touch.startPositionX = this.state.currentX;
                    
                    this.state.isDragging = true;
                    this.slider.classList.add('slider--dragging');
                    
                    // Генерируем событие начала перетаскивания
                    this.dispatchEvent('sliderDragStart', {
                        startX: this.touch.startX,
                        startY: this.touch.startY,
                        currentPosition: this.state.currentX
                    });
                }
            }
        }
        
        // ГОРИЗОНТАЛЬНЫЙ СВАЙП - двигаем слайдер
        if (this.touch.isDirectionDetermined && this.touch.isHorizontalSwipe) {
            // Блокируем дефолтное поведение ТОЛЬКО для горизонтального свайпа
            e.preventDefault();
            // Вычисляем новую позицию трека
            let newPositionX = this.touch.startPositionX + deltaX;
            
            // Применяем эффект резиновых краев
            newPositionX = this.applyRubberBand(newPositionX, deltaX);
            
            // Применяем позицию
            this.state.currentX = newPositionX;
            this.state.targetX = newPositionX;
            this.track.style.transform = `translate3d(${newPositionX}px, 0, 0)`;
            
            // Записываем в историю для расчета скорости
            const now = Date.now();
            this.touch.history.push({ x: newPositionX, time: now });
            
            // Очищаем старые записи (оставляем последние 150мс)
            this.touch.history = this.touch.history.filter(
                point => now - point.time <= 150
            );
        }
        // Вертикальный свайп - нативный скролл работает автоматически
        // (e.preventDefault не вызывался)
    }

    handleTouchEnd(e) {
        // Сбрасываем флаг касания
        this.touch.isTouching = false;
        
        // Если это был не горизонтальный свайп (или направление не определено) - выходим
        if (!this.state.isDragging) {
            return;
        }
        
        // Вычисляем финальное смещение
        const deltaX = this.touch.currentX - this.touch.startX;
        const deltaY = this.touch.currentY - this.touch.startY;
        const deltaTime = Date.now() - this.touch.startTime;
        
        // Расчет скорости по истории за последние 100мс
        // Умножаем на 16 для ~60fps (скорость в пикселях за кадр)
        this.touch.velocityX = this.calculateVelocity() * 16;
        
        // Снимаем флаг перетаскивания
        this.state.isDragging = false;
        
        // Убираем визуальный класс
        this.slider.classList.remove('slider--dragging');
        
        // Запускаем инерцию
        if (!this.animation.isAnimating) {
            this.animation.isAnimating = true;
            this.animate();
        }
        
        // Генерируем событие sliderDragEnd
        this.dispatchEvent('sliderDragEnd', {
            endX: this.touch.currentX,
            endY: this.touch.currentY,
            deltaX: deltaX,
            deltaY: deltaY,
            velocityX: this.touch.velocityX,
            currentPosition: this.state.currentX,
            duration: deltaTime
        });
    }

    handleMouseDown(e) {
        console.log('mousedown', e.clientX);
        // Логика будет добавлена позже
    }

    handleMouseMove(e) {
        // console.log('mousemove'); // Закомментировано, чтобы не спамить в консоль
        // Логика будет добавлена позже
    }

    handleMouseUp(e) {
        console.log('mouseup');
        // Логика будет добавлена позже
    }

    /**
     * Расчет скорости на основе истории позиций за последние 100мс
     * Это решает проблему рывков, которая есть в Swiper
     * @returns {number} Скорость в пикселях на миллисекунду
     */
    calculateVelocity() {
        const now = Date.now();
        const timeWindow = 100; // Временное окно в миллисекундах
        
        // Фильтруем историю - оставляем только записи за последние 100мс
        const recentHistory = this.touch.history.filter(
            point => now - point.time <= timeWindow
        );
        
        // Если недостаточно данных, возвращаем 0
        if (recentHistory.length < 2) {
            return 0;
        }
        
        // Берем первую и последнюю точки в окне
        const firstPoint = recentHistory[0];
        const lastPoint = recentHistory[recentHistory.length - 1];
        
        // Вычисляем смещение и время
        const deltaX = lastPoint.x - firstPoint.x;
        const deltaTime = lastPoint.time - firstPoint.time;
        
        // Защита от деления на ноль
        if (deltaTime === 0) {
            return 0;
        }
        
        // Возвращаем скорость (пиксели / миллисекунда)
        return deltaX / deltaTime;
    }

    /**
     * RAF цикл анимации с физикой, инерцией и резиновыми краями
     * НЕ использует CSS transition - полный контроль через JavaScript
     * Поддерживает два режима: FreeMode и Snap
     */
    animate() {
        // Если не анимируем, выходим
        if (!this.animation.isAnimating) {
            return;
        }
        
        const bounds = this.getBounds();
        
        /**
         * РЕЖИМ SNAP: Плавное довод до ближайшего слайда
         */
        if (this.state.isSnapping) {
            // Вычисляем разницу между текущей и целевой позицией
            const diff = this.state.snapTargetX - this.state.currentX;
            
            // Плавная анимация с easing (как на Авито)
            // Используем более агрессивный коэффициент для быстрого завершения
            const snapEasing = 0.15; // Быстрее чем snapSpeed
            this.state.currentX += diff * snapEasing;
            
            // Если очень близко к целевой позиции, фиксируем
            if (Math.abs(diff) < 0.5) {
                this.state.currentX = this.state.snapTargetX;
                this.state.isSnapping = false;
                this.animation.isAnimating = false;
                this.animation.rafId = null;
                
                // Применяем финальную позицию
                this.track.style.transform = `translate3d(${this.state.currentX}px, 0, 0)`;
                
                // Проверяем видимость последнего слайда
                this.checkLastSlideVisibility();
                
                // Генерируем событие завершения snap
                this.dispatchEvent('sliderSnapComplete', {
                    slideIndex: this.state.currentSlideIndex,
                    position: this.state.currentX
                });
                
                // Генерируем событие полной остановки
                this.dispatchEvent('sliderStop', {
                    position: this.state.currentX,
                    slideIndex: this.state.currentSlideIndex
                });
                
                return;
            }
            
            // Применяем позицию и продолжаем анимацию
            this.track.style.transform = `translate3d(${this.state.currentX}px, 0, 0)`;
            
            // Проверяем видимость последнего слайда
            this.checkLastSlideVisibility();
            
            // Генерируем событие sliderMove при изменении позиции
            if (this.state.currentX !== this.state.previousX) {
                this.dispatchEvent('sliderMove', {
                    position: this.state.currentX,
                    delta: this.state.currentX - this.state.previousX
                });
                this.state.previousX = this.state.currentX;
            }
            
            this.animation.rafId = requestAnimationFrame(this.animate);
            return;
        }
        
        /**
         * РЕЖИМ FREE MODE: Свободное движение с инерцией
         */
        
        // ФИЗИКА ИНЕРЦИИ: Применяем трение
        // Если палец не на экране, скорость постепенно уменьшается
        if (!this.state.isDragging) {
            this.touch.velocityX *= this.options.friction;
            
            // Проверяем активацию snap в Snap режиме когда скорость снизилась
            if (!this.options.freeMode && !this.state.isSnapping && Math.abs(this.touch.velocityX) < this.options.velocityThreshold * 3) {
                // Скорость достаточно снизилась - активируем snap
                const nearestSlide = this.findNearestSlide(this.state.currentX, this.touch.velocityX);
                
                this.state.isSnapping = true;
                this.state.snapTargetX = nearestSlide.position;
                
                // Проверяем изменение слайда
                if (nearestSlide.index !== this.state.currentSlideIndex) {
                    this.state.previousSlideIndex = this.state.currentSlideIndex;
                    this.state.currentSlideIndex = nearestSlide.index;
                    
                    // Генерируем событие смены слайда
                    this.dispatchEvent('slideChange', {
                        slideIndex: this.state.currentSlideIndex,
                        previousIndex: this.state.previousSlideIndex
                    });
                } else {
                    this.state.currentSlideIndex = nearestSlide.index;
                }
                
                // Генерируем событие начала snap
                this.dispatchEvent('sliderSnapStart', {
                    slideIndex: nearestSlide.index,
                    targetPosition: nearestSlide.position
                });
                
                // Переключаемся в режим snap (вернемся в начало цикла animate)
                this.animation.rafId = requestAnimationFrame(this.animate);
                return;
            }
        }
        
        // Применяем скорость к позиции (инерция)
        this.state.currentX += this.touch.velocityX;
        
        /**
         * РЕЗИНОВЫЕ КРАЯ - ЭФФЕКТ ПРУЖИНЫ
         * Если слайдер вылетел за границы во время инерции,
         * плавно возвращаем его назад с эффектом пружины
         */
        if (this.state.currentX > bounds.max) {
            // Вышли за правую границу (начало)
            const overshoot = this.state.currentX - bounds.max;
            
            // Применяем силу пружины (bounce) - притягиваем к границе
            // Чем дальше от границы, тем сильнее сила возврата
            const springForce = -overshoot * this.options.bounce;
            this.touch.velocityX += springForce;
            
            // Дополнительное затухание для плавности
            this.touch.velocityX *= 0.95;
            
            // Если очень близко к границе и скорость мала, фиксируем на границе
            if (Math.abs(overshoot) < 1 && Math.abs(this.touch.velocityX) < 0.1) {
                this.state.currentX = bounds.max;
                this.touch.velocityX = 0;
            }
            
        } else if (this.state.currentX < bounds.min) {
            // Вышли за левую границу (конец)
            const overshoot = bounds.min - this.state.currentX;
            
            // Применяем силу пружины - притягиваем к границе
            const springForce = overshoot * this.options.bounce;
            this.touch.velocityX += springForce;
            
            // Дополнительное затухание для плавности
            this.touch.velocityX *= 0.95;
            
            // Если очень близко к границе и скорость мала, фиксируем на границе
            if (Math.abs(overshoot) < 1 && Math.abs(this.touch.velocityX) < 0.1) {
                this.state.currentX = bounds.min;
                this.touch.velocityX = 0;
            }
        }
        
        // Применяем позицию к DOM через transform
        this.track.style.transform = `translate3d(${this.state.currentX}px, 0, 0)`;
        
        // Проверяем видимость последнего слайда
        this.checkLastSlideVisibility();
        
        // Генерируем событие sliderMove при изменении позиции
        if (this.state.currentX !== this.state.previousX) {
            this.dispatchEvent('sliderMove', {
                position: this.state.currentX,
                delta: this.state.currentX - this.state.previousX,
                velocity: this.touch.velocityX
            });
            this.state.previousX = this.state.currentX;
        }
        
        // Проверяем остановку в free mode (когда velocity близка к 0)
        if (Math.abs(this.touch.velocityX) < this.options.velocityThreshold) {
            this.touch.velocityX = 0;
            this.animation.isAnimating = false;
            this.animation.rafId = null;
            
            // Генерируем событие полной остановки
            this.dispatchEvent('sliderStop', {
                position: this.state.currentX
            });
            
            return; // Останавливаем RAF
        }
        
        // Продолжаем цикл анимации
        this.animation.rafId = requestAnimationFrame(this.animate);
    }

    /**
     * Получение границ слайдера (минимальная и максимальная позиция)
     * @returns {{min: number, max: number}}
     */
    getBounds() {
        // Максимум - начальная позиция (0)
        const max = 0;
        
        // Минимум - когда последний слайд виден справа
        // trackWidth - полная ширина всех слайдов
        // sliderWidth - видимая область
        const min = -(this.state.trackWidth - this.state.sliderWidth);
        
        return { min, max };
    }

    /**
     * Проверка, находится ли позиция за границами
     * @param {number} position - Проверяемая позиция
     * @returns {boolean}
     */
    isOutOfBounds(position) {
        const bounds = this.getBounds();
        return position > bounds.max || position < bounds.min;
    }

    /**
     * Применение эффекта резиновых краев (rubber band)
     * Если тянем за границу, применяем коэффициент сопротивления
     * Используем логарифмическую функцию для более естественного ощущения
     * @param {number} position - Желаемая позиция
     * @param {number} delta - Смещение от предыдущей позиции
     * @returns {number} Скорректированная позиция с эффектом резинки
     */
    applyRubberBand(position, delta) {
        const bounds = this.getBounds();
        
        // Если позиция в пределах границ, возвращаем как есть
        if (position >= bounds.min && position <= bounds.max) {
            return position;
        }
        
        // Коэффициент сопротивления (0.5 = 50% от движения проходит)
        // Увеличен для более легкого перетаскивания
        const resistance = 0.5;
        
        // Если вышли за правую границу (начало, первый слайд)
        if (position > bounds.max) {
            const overshoot = position - bounds.max;
            // Логарифмическое сопротивление - чем дальше тянем, тем сильнее сопротивление
            // Но в начале движение почти свободное
            const dampedOvershoot = Math.sign(overshoot) * Math.pow(Math.abs(overshoot), 0.7) * resistance;
            return bounds.max + dampedOvershoot;
        }
        
        // Если вышли за левую границу (конец, последний слайд)
        if (position < bounds.min) {
            const overshoot = bounds.min - position;
            const dampedOvershoot = Math.sign(overshoot) * Math.pow(Math.abs(overshoot), 0.7) * resistance;
            return bounds.min - dampedOvershoot;
        }
        
        return position;
    }

    /**
     * Ограничение значения в пределах min и max
     * @param {number} value - Значение
     * @param {number} min - Минимум
     * @param {number} max - Максимум
     * @returns {number}
     */
    clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
    }

    /**
     * Проверка видимости последнего слайда
     * Генерирует события lastSlideVisibleStart и lastSlideVisibleFull
     */
    checkLastSlideVisibility() {
        if (this.slides.length === 0) {
            return;
        }
        
        const lastSlide = this.slides[this.slides.length - 1];
        const lastSlideOffset = lastSlide.offsetLeft;
        const lastSlideWidth = lastSlide.offsetWidth;
        
        // Правый край последнего слайда относительно трека
        const lastSlideRight = lastSlideOffset + lastSlideWidth;
        
        // Правый край viewport относительно трека
        // currentX отрицательный при прокрутке вправо
        const viewportRight = -this.state.currentX + this.state.sliderWidth;
        
        // Левый край viewport
        const viewportLeft = -this.state.currentX;
        
        // Проверка: последний слайд начал показываться (хотя бы 1px виден)
        const isVisibleStart = lastSlideOffset < viewportRight;
        
        // Проверка: последний слайд полностью виден
        const isVisibleFull = lastSlideOffset >= viewportLeft && 
                              lastSlideRight <= viewportRight;
        
        // Событие lastSlideVisibleStart (только при переходе false -> true)
        if (isVisibleStart && !this.state.lastSlideVisibleStart) {
            this.state.lastSlideVisibleStart = true;
            this.dispatchEvent('lastSlideVisibleStart', {
                slideIndex: this.slides.length - 1,
                position: this.state.currentX
            });
        } else if (!isVisibleStart && this.state.lastSlideVisibleStart) {
            // Сбрасываем флаг если слайд ушел из viewport
            this.state.lastSlideVisibleStart = false;
        }
        
        // Событие lastSlideVisibleFull (только при переходе false -> true)
        if (isVisibleFull && !this.state.lastSlideVisibleFull) {
            this.state.lastSlideVisibleFull = true;
            this.dispatchEvent('lastSlideVisibleFull', {
                slideIndex: this.slides.length - 1,
                position: this.state.currentX
            });
        } else if (!isVisibleFull && this.state.lastSlideVisibleFull) {
            // Сбрасываем флаг если слайд больше не полностью виден
            this.state.lastSlideVisibleFull = false;
        }
    }

    /**
     * Получение позиций всех слайдов с учетом выравнивания
     * @returns {Array} Массив объектов {index, position, element}
     */
    getSlidePositions() {
        const positions = [];
        let accumulatedOffset = 0;
        
        this.slides.forEach((slide, index) => {
            const slideWidth = slide.offsetWidth;
            
            // Вычисляем позицию в зависимости от режима выравнивания
            let position;
            
            if (this.options.snapAlign === 'center') {
                // Центрирование: слайд по центру экрана
                const slideCenter = accumulatedOffset + slideWidth / 2;
                const containerCenter = this.state.sliderWidth / 2;
                position = -(slideCenter - containerCenter);
            } else {
                // 'start': слайд по левому краю (по умолчанию)
                position = -accumulatedOffset;
            }
            
            positions.push({
                index: index,
                position: position,
                element: slide,
                width: slideWidth,
                offset: accumulatedOffset
            });
            
            accumulatedOffset += slideWidth;
        });
        
        return positions;
    }

    /**
     * Поиск ближайшего слайда с учетом текущей позиции и скорости
     * Учитывает силу броска: быстрый свайп пропускает несколько слайдов
     * @param {number} currentPosition - Текущая позиция трека
     * @param {number} velocity - Скорость движения (пиксели/мс)
     * @returns {{index: number, position: number}}
     */
    findNearestSlide(currentPosition, velocity = 0) {
        const slidePositions = this.getSlidePositions();
        
        if (slidePositions.length === 0) {
            return { index: 0, position: 0 };
        }
        
        // Вычисляем прогнозируемое смещение на основе скорости
        // velocityMultiplier определяет, насколько сильно скорость влияет на выбор слайда
        const velocityOffset = velocity * this.options.velocityMultiplier * 100;
        
        // Прогнозируемая позиция с учетом инерции
        const projectedPosition = currentPosition + velocityOffset;
        
        // Ищем ближайший слайд к прогнозируемой позиции
        let nearestSlide = slidePositions[0];
        let minDistance = Math.abs(projectedPosition - nearestSlide.position);
        
        slidePositions.forEach(slide => {
            const distance = Math.abs(projectedPosition - slide.position);
            
            if (distance < minDistance) {
                minDistance = distance;
                nearestSlide = slide;
            }
        });
        
        // ВАЖНО: Учитываем направление свайпа
        // Если скорость высокая, гарантируем переход на следующий слайд
        const currentSlideIndex = this.state.currentSlideIndex;
        const velocityThreshold = 0.5; // Порог скорости для гарантированного перехода
        
        if (Math.abs(velocity) > velocityThreshold) {
            if (velocity < 0) {
                // Свайп влево (к следующему слайду)
                const nextIndex = Math.min(currentSlideIndex + 1, slidePositions.length - 1);
                if (nextIndex > currentSlideIndex) {
                    nearestSlide = slidePositions[nextIndex];
                }
            } else if (velocity > 0) {
                // Свайп вправо (к предыдущему слайду)
                const prevIndex = Math.max(currentSlideIndex - 1, 0);
                if (prevIndex < currentSlideIndex) {
                    nearestSlide = slidePositions[prevIndex];
                }
            }
        }
        
        // Проверяем границы трека
        const bounds = this.getBounds();
        const clampedPosition = this.clamp(nearestSlide.position, bounds.min, bounds.max);
        
        return {
            index: nearestSlide.index,
            position: clampedPosition
        };
    }

    /**
     * Обработчик изменения размеров окна
     */
    handleResize() {
        // Пересчитываем размеры при ресайзе
        this.calculateDimensions();
        
        // Применяем текущую позицию (на случай если нужно скорректировать)
        this.setTrackPosition(this.state.currentX);
        
        console.log('Resize обработан');
    }

    /**
     * Генерация и диспетчеризация кастомного события
     * @param {string} eventName - Название события
     * @param {Object} detail - Дополнительные данные события
     */
    dispatchEvent(eventName, detail = {}) {
        const event = new CustomEvent(eventName, {
            detail: detail,
            bubbles: true,
            cancelable: true
        });
        
        this.slider.dispatchEvent(event);
        
        // Вызываем обработчики из API
        if (this.eventHandlers[eventName]) {
            this.eventHandlers[eventName].forEach(handler => {
                handler(event);
            });
        }
    }

    /**
     * API: Подписка на событие
     * @param {string} eventName - Название события
     * @param {Function} handler - Обработчик события
     * @returns {TouchSlider} Возвращает this для цепочки вызовов
     */
    on(eventName, handler) {
        if (typeof handler !== 'function') {
            console.warn('TouchSlider.on: handler должен быть функцией');
            return this;
        }
        
        // Инициализируем массив обработчиков для события, если его нет
        if (!this.eventHandlers[eventName]) {
            this.eventHandlers[eventName] = [];
        }
        
        // Добавляем обработчик
        this.eventHandlers[eventName].push(handler);
        
        return this;
    }

    /**
     * API: Отписка от события
     * @param {string} eventName - Название события
     * @param {Function} handler - Обработчик события (опционально)
     * @returns {TouchSlider} Возвращает this для цепочки вызовов
     */
    off(eventName, handler) {
        // Если события нет, ничего не делаем
        if (!this.eventHandlers[eventName]) {
            return this;
        }
        
        // Если handler не указан, удаляем все обработчики события
        if (!handler) {
            delete this.eventHandlers[eventName];
            return this;
        }
        
        // Удаляем конкретный обработчик
        this.eventHandlers[eventName] = this.eventHandlers[eventName].filter(
            h => h !== handler
        );
        
        // Если обработчиков не осталось, удаляем массив
        if (this.eventHandlers[eventName].length === 0) {
            delete this.eventHandlers[eventName];
        }
        
        return this;
    }

    /**
     * Уничтожение экземпляра слайдера
     * Удаляет все слушатели событий
     */
    destroy() {
        // Останавливаем RAF анимацию
        if (this.animation.rafId) {
            cancelAnimationFrame(this.animation.rafId);
            this.animation.rafId = null;
            this.animation.isAnimating = false;
        }
        
        // Удаляем touch слушатели
        this.slider.removeEventListener('touchstart', this.handleTouchStart);
        this.slider.removeEventListener('touchmove', this.handleTouchMove);
        this.slider.removeEventListener('touchend', this.handleTouchEnd);
        this.slider.removeEventListener('touchcancel', this.handleTouchEnd);

        // Удаляем mouse слушатели
        this.slider.removeEventListener('mousedown', this.handleMouseDown);
        window.removeEventListener('mousemove', this.handleMouseMove);
        window.removeEventListener('mouseup', this.handleMouseUp);

        // Удаляем resize слушатель
        window.removeEventListener('resize', this.handleResize);

        console.log('TouchSlider уничтожен');
    }
}
