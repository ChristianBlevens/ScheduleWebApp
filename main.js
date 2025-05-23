dayjs.extend(window.dayjs_plugin_customParseFormat);
dayjs.extend(window.dayjs_plugin_duration);

document.addEventListener('alpine:init', () => {
    Alpine.data('habitTracker', () => ({
        habits: [],
        currentDate: TimeUtils.getDateKey(),
        isAwake: false,
        wakeUpTime: '',
        showModal: false,
        showAnalytics: false,
        showSummary: false,
        showMarkdownHelp: false,
        selectedTags: [],
        sortableInstance: null,
        lastActiveInput: 'main',
        
        isDragging: false,
        dragPosition: 0,
        dragTimeDisplay: '',
        draggingHabitId: null,
        dragStartY: 0,
        touchStartTime: 0,
        
        editingHabit: null,
        form: {
            title: '',
            description: '',
            time: '09:00',
            duration: 30,
            tags: [],
            subHabits: [],
            isDynamic: false,
            offsetMinutes: 60
        },
        tagInput: '',
        
        streak: 0,
        weeklyRate: 0,
        dailyStats: {
            today: { completed: 0, total: 0, rate: 0 },
            yesterday: { completed: 0, total: 0, rate: 0 },
            week: { completed: 0, total: 0, rate: 0 },
            allTime: { completed: 0, total: 0, rate: 0 }
        },
        summaryStats: { vsYesterday: 0, vsWeek: 0 },
        
        timeSlots: [],
        currentTimePosition: 0,
        timelineHeight: 800,
        viewportHeight: 0,
        scrollTop: 0,
        visibleRange: { start: 0, end: 0 },
        
        updateTimer: null,
        resizeObserver: null,
        hammerInstance: null,
        
        getDefaultDailyStats() {
            return {
                today: { completed: 0, total: 0, rate: 0 },
                yesterday: { completed: 0, total: 0, rate: 0 },
                week: { completed: 0, total: 0, rate: 0 },
                allTime: { completed: 0, total: 0, rate: 0 }
            };
        },
        
        getDefaultForm() {
            return {
                title: '',
                description: '',
                time: '09:00',
                duration: 30,
                tags: [],
                subHabits: [],
                isDynamic: false,
                offsetMinutes: 60
            };
        },
        
        get completedCount() {
            return this.habits?.filter(h => h?.completed)?.length || 0;
        },
        
        get progressPercent() {
            return this.habits?.length ? Math.round((this.completedCount / this.habits.length) * 100) : 0;
        },
        
        get availableTags() {
            if (!this.habits || !Array.isArray(this.habits)) return [];
            const tags = new Set();
            this.habits.forEach(h => {
                if (h?.tags && Array.isArray(h.tags)) {
                    h.tags.forEach(tag => tags.add(tag));
                }
            });
            return Array.from(tags).sort();
        },
        
        get filteredHabits() {
            if (!this.habits || !Array.isArray(this.habits)) return [];
            if (!this.selectedTags?.length) return this.habits;
            return this.habits.filter(h => 
                h?.tags && Array.isArray(h.tags) && 
                this.selectedTags.some(tag => h.tags.includes(tag))
            );
        },
        
        get visibleTimeSlots() {
            return this.timeSlots || [];
        },
        
        get visibleHabits() {
            const habitsToShow = this.selectedTags.length > 0 ? this.filteredHabits : this.habits;
            if (!habitsToShow.length) return [];
            
            const buffer = 100;
            return habitsToShow.filter(habit => 
                !habit.hidden &&
                habit.position >= this.visibleRange.start - buffer && 
                habit.position <= this.visibleRange.end + buffer
            );
        },

        getCurrentTime() {
            return TimeUtils.getCurrentTime();
        },

        getTimeAgo() {
            const wakeTime = dayjs(this.wakeUpTime, 'HH:mm');
            const now = dayjs();
            const minutesSinceWake = now.diff(wakeTime, 'minute');
            
            if (minutesSinceWake < 0) return "not yet";
            if (minutesSinceWake === 0) return "just now";
            
            const duration = dayjs.duration(minutesSinceWake, 'minutes');
            const hours = Math.floor(duration.asHours());
            const mins = duration.minutes();
            
            return hours > 0 ? `${hours}h ${mins}m ago` : `${mins}m ago`;
        },

        calculateTimeFromPosition(position) {
            const timeline = TimelineCalculator.positionToTime(position, this.timeSlots, this.wakeUpTime);
            return timeline.timeStr;
        },

        handleTouchStart(event) {
            if (event.target.closest('.drag-handle')) {
                const habitId = event.target.closest('.drag-handle').dataset.habitId;
                this.touchStartTime = Date.now();
                this.handleDragStart(habitId, event.touches[0].clientY);
            }
        },

        handleTouchMove(event) {
            if (this.isDragging) {
                event.preventDefault();
                this.handleDragMove(event.touches[0].clientY);
            }
        },

        handleTouchEnd(event) {
            if (this.isDragging) {
                this.handleDragEnd();
            }
        },

        handleMouseDown(event) {
            if (event.target.closest('.drag-handle')) {
                const habitId = event.target.closest('.drag-handle').dataset.habitId;
                this.handleDragStart(habitId, event.clientY);
            }
        },

        handleMouseMove(event) {
            if (this.isDragging) {
                this.handleDragMove(event.clientY);
            }
        },

        handleMouseUp(event) {
            if (this.isDragging) {
                this.handleDragEnd();
            }
        },

        handleDragStart(habitId, clientY) {
            this.isDragging = true;
            this.draggingHabitId = habitId;
            this.dragStartY = clientY;
            document.body.classList.add('dragging');
            
            const habit = this.habits.find(h => h.id === habitId);
            if (habit) {
                this.dragPosition = habit.position;
            }
        },

        handleDragMove(clientY) {
            if (!this.isDragging) return;
            
            const timeline = this.$refs.timeline;
            const rect = timeline.getBoundingClientRect();
            const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
            const relativeY = clientY + scrollTop - rect.top - scrollTop;
            
            this.dragPosition = Math.max(0, Math.min(this.timelineHeight, relativeY));
            
            const time = this.calculateTimeFromPosition(this.dragPosition);
            if (time) {
                this.dragTimeDisplay = TimeUtils.formatTime(time, true);
            }
            
            if (clientY < 100) {
                window.scrollBy(0, -10);
            } else if (clientY > window.innerHeight - 100) {
                window.scrollBy(0, 10);
            }
        },

        handleDragEnd() {
            if (!this.isDragging || !this.draggingHabitId) return;
            
            const rawTime = this.calculateTimeFromPosition(this.dragPosition);
            
            if (rawTime) {
                const habit = this.habits.find(h => h.id === this.draggingHabitId);
                if (habit) {
                    let minutesSinceWake = TimeUtils.getMinutesSinceWake(rawTime, this.wakeUpTime);
                    minutesSinceWake = Math.max(1, Math.min(1439, minutesSinceWake));
                    
                    const clampedTime = TimeUtils.addMinutesToTime(this.wakeUpTime, minutesSinceWake);
                    
                    if (habit.isDynamic) {
                        habit.offsetMinutes = minutesSinceWake;
                        habit.effectiveTime = clampedTime;
                    } else {
                        habit.time = clampedTime;
                        habit.effectiveTime = clampedTime;
                    }
                    
                    this.updateHighlighting();
                    this.sortByTime();
                    this.rebuildTimeline();
                    this.saveData();
                }
            }
            
            document.body.classList.remove('dragging');
            this.isDragging = false;
            this.dragPosition = 0;
            this.dragTimeDisplay = '';
            this.draggingHabitId = null;
        },

        handleViewportScroll() {
            this.updateVisibleRange();
        },

        updateVisibleRange() {
            const timeline = this.$refs.timeline;
            if (!timeline) return;
            
            const rect = timeline.getBoundingClientRect();
            const windowHeight = window.innerHeight;
            const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
            
            const visibleTop = Math.max(0, -rect.top);
            const visibleBottom = visibleTop + windowHeight;
            
            this.visibleRange = {
                start: visibleTop,
                end: visibleBottom
            };
        },

        async init() {
            try {
                this.resetModalStates();
                this.wakeUpTime = this.getCurrentTime();
                
                await this.loadData();
                this.calculateAnalytics();
                this.updateTimeline();
                this.updateHighlighting();
                await Notifications.request();
                
                this.setupWatchers();
                this.setupTimers();
                
                this.$nextTick(() => {
                    this.setupResponsiveHandlers();
                    this.setupDragDrop();
                    this.updateVisibleRange();
                    this.scrollToCurrentTime();
                    
                    window.addEventListener('scroll', () => {
                        this.updateVisibleRange();
                    });
                });
                
            } catch (error) {
                console.error('Init error:', error);
                this.habits = [];
                this.isAwake = false;
            }
        },

        resetModalStates() {
            this.showModal = false;
            this.showAnalytics = false;
            this.showSummary = false;
            this.showMarkdownHelp = false;
        },

        setupWatchers() {
            this.$watch('selectedTags', () => {
                if (this.isAwake) {
                    this.$nextTick(() => {
                        this.updateTimeline();
                        this.scrollToCurrentTime();
                    });
                }
            }, { deep: true });
            
            this.$watch('isAwake', () => {
                if (this.isAwake) {
                    this.$nextTick(() => {
                        this.updateTimeline();
                        this.scrollToCurrentTime();
                    });
                }
            });
        },

        setupTimers() {
            this.updateTimer = setInterval(() => {
                const newDate = TimeUtils.getDateKey();
                if (newDate !== this.currentDate) {
                    this.currentDate = newDate;
                    this.isAwake = false;
                    this.wakeUpTime = this.getCurrentTime();
                    this.loadData();
                }
                this.updateHighlighting();
                this.updateCurrentTimePosition();
                
                if (!this.isAwake) {
                    this.wakeUpTime = this.getCurrentTime();
                }
            }, 60000);
        },

        async loadData() {
            try {
                const data = await Storage.load();
                const today = this.currentDate;
                
                this.isAwake = data.awake?.[today] === true;
                this.wakeUpTime = data.wakeUpTimes?.[today] || this.getCurrentTime();
                
                this.habits = (data.templates || []).map(template => {
                    const habitData = this.processHabitTemplate(template);
                    return {
                        ...habitData,
                        completed: data.completions?.[today]?.includes(template.id) || false,
                        expanded: false,
                        subHabits: (habitData.subHabits || []).map(sub => ({
                            ...sub,
                            completed: data.subCompletions?.[today]?.includes(sub.id) || false
                        }))
                    };
                });
                
                this.sortByTime();
                this.updateTimeline();
            } catch (error) {
                console.error('Load data error:', error);
                this.habits = [];
                this.isAwake = false;
            }
        },

        processHabitTemplate(template) {
            let effectiveTime;
            let correctedTemplate = { ...template };
            
            if (template.isDynamic) {
                const clampedOffset = Math.max(1, Math.min(1439, template.offsetMinutes || 1));
                effectiveTime = TimeUtils.addMinutesToTime(this.wakeUpTime, clampedOffset);
                
                if (clampedOffset !== template.offsetMinutes) {
                    correctedTemplate.offsetMinutes = clampedOffset;
                }
            } else {
                let minutesSinceWake = TimeUtils.getMinutesSinceWake(template.time, this.wakeUpTime);
                minutesSinceWake = Math.max(1, Math.min(1439, minutesSinceWake));
                effectiveTime = TimeUtils.addMinutesToTime(this.wakeUpTime, minutesSinceWake);
                
                const originalMinutes = TimeUtils.getMinutesSinceWake(template.time, this.wakeUpTime);
                if (originalMinutes !== minutesSinceWake) {
                    correctedTemplate.time = effectiveTime;
                }
            }
            
            return {
                ...correctedTemplate,
                effectiveTime,
                description: template.description || '',
                subHabits: (template.subHabits || []).map(sub => ({
                    ...sub,
                    description: sub.description || ''
                }))
            };
        },

        async saveData() {
            try {
                const data = await Storage.load();
                const today = this.currentDate;
                
                data.templates = this.habits.map(h => ({
                    id: h.id,
                    title: h.title,
                    description: h.description,
                    time: h.time,
                    effectiveTime: h.effectiveTime,
                    duration: h.duration,
                    tags: h.tags || [],
                    isDynamic: h.isDynamic || false,
                    offsetMinutes: h.offsetMinutes || 0,
                    subHabits: (h.subHabits || []).map(s => ({ 
                        id: s.id, 
                        title: s.title,
                        description: s.description || ''
                    }))
                }));
                
                this.ensureDataStructure(data);
                
                data.completions[today] = this.habits.filter(h => h.completed).map(h => h.id);
                data.subCompletions[today] = this.habits.flatMap(h => 
                    (h.subHabits || []).filter(s => s.completed).map(s => s.id)
                );
                data.awake[today] = this.isAwake;
                data.wakeUpTimes[today] = this.wakeUpTime;
                
                await Storage.save(data);
            } catch (error) {
                console.error('Save data error:', error);
            }
        },

        ensureDataStructure(data) {
            if (!data.completions) data.completions = {};
            if (!data.subCompletions) data.subCompletions = {};
            if (!data.awake) data.awake = {};
            if (!data.wakeUpTimes) data.wakeUpTimes = {};
        },

        rebuildTimeline() {
            this.$nextTick(() => {
                this.updateTimeline();
            });
        },

        updateTimeline() {
            try {
                if (!this.isAwake) {
                    this.timeSlots = [];
                    this.timelineHeight = 800;
                    return;
                }
                
                const habitsForTimeline = this.selectedTags.length > 0 ? this.filteredHabits : this.habits;
                const timeline = TimelineCalculator.generateTimeline(habitsForTimeline, this.wakeUpTime);
                
                this.timeSlots = [...timeline.slots];
                this.timelineHeight = timeline.height;
                
                this.habits.forEach(habit => {
                    const isVisible = this.selectedTags.length === 0 || 
                                    (habit.tags && habit.tags.some(tag => this.selectedTags.includes(tag)));
                    
                    if (isVisible) {
                        const position = TimelineCalculator.timeToPosition(
                            habit.effectiveTime,
                            this.timeSlots,
                            this.wakeUpTime
                        );
                        habit.position = position;
                        habit.hidden = false;
                    } else {
                        habit.hidden = true;
                        habit.position = -1000;
                    }
                });
                
                this.updateCurrentTimePosition();
                
                this.$nextTick(() => {
                    this.setupDragDrop();
                    this.updateVisibleRange();
                });
            } catch (error) {
                console.error('Update timeline error:', error);
                this.timeSlots = [];
                this.timelineHeight = 800;
            }
        },

        updateCurrentTimePosition() {
            try {
                const position = TimelineCalculator.timeToPosition(
                    this.getCurrentTime(),
                    this.timeSlots,
                    this.wakeUpTime
                );
                this.currentTimePosition = position;
            } catch (error) {
                console.error('Update current time position error:', error);
                this.currentTimePosition = 100;
            }
        },

        scrollToCurrentTime() {
            const timeline = this.$refs.timeline;
            if (!timeline) return;
            
            const rect = timeline.getBoundingClientRect();
            const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
            const timelineTop = rect.top + scrollTop;
            const targetScroll = timelineTop + this.currentTimePosition - window.innerHeight / 2;
            
            window.scrollTo({
                top: Math.max(0, targetScroll),
                behavior: 'smooth'
            });
        },

        toggleCompletion(habit) {
            if (!habit) return;
            
            habit.completed = !habit.completed;
            if (habit.completed && habit.subHabits) {
                habit.subHabits.forEach(sub => sub.completed = true);
                
                const element = document.querySelector(`[data-habit-id="${habit.id}"]`);
                if (element) {
                    element.classList.add('completion-celebration');
                    setTimeout(() => element.classList.remove('completion-celebration'), 600);
                }
            }
            
            this.updateAfterChange();
        },

        toggleSubHabit(habit, subHabit) {
            if (!habit || !subHabit) return;
            
            subHabit.completed = !subHabit.completed;
            this.updateAfterChange();
        },

        editHabit(habit) {
            if (!habit) return;
            
            this.editingHabit = null;
            this.showModal = false;
            
            this.$nextTick(() => {
                if (habit.isDynamic) {
                    habit.effectiveTime = TimeUtils.addMinutesToTime(this.wakeUpTime, habit.offsetMinutes || 0);
                }
                
                this.editingHabit = habit;
                this.form = {
                    title: habit.title || '',
                    description: habit.description || '',
                    time: habit.time || habit.effectiveTime || '09:00',
                    duration: habit.duration || 30,
                    tags: Array.isArray(habit.tags) ? [...habit.tags] : [],
                    subHabits: Array.isArray(habit.subHabits) ? habit.subHabits.map(s => ({ 
                        ...s,
                        description: s.description || '' 
                    })) : [],
                    isDynamic: habit.isDynamic || false,
                    offsetMinutes: habit.offsetMinutes || 60
                };
                
                this.showModal = true;
                this.lastActiveInput = 'main';
            });
        },

        deleteHabit(habit) {
            if (!habit) return;
            
            if (confirm(`Delete "${habit.title}"?`)) {
                this.habits = this.habits.filter(h => h.id !== habit.id);
                this.updateAfterChange();
            }
        },

        saveHabit() {
            if (!this.form.title?.trim()) return;
            
            try {
                const habitData = this.createHabitData();
                
                if (this.editingHabit) {
                    const index = this.habits.findIndex(h => h.id === this.editingHabit.id);
                    if (index >= 0) {
                        habitData.completed = this.habits[index].completed;
                        this.habits[index] = { ...this.habits[index], ...habitData };
                    }
                } else {
                    this.habits.push(habitData);
                }
                
                this.closeModal();
                this.updateHighlighting();
                this.updateAfterChange();
            } catch (error) {
                console.error('Save habit error:', error);
            }
        },

        createHabitData() {
            const habitData = {
                id: this.editingHabit?.id || Utils.generateId(),
                title: Utils.sanitize(this.form.title),
                description: this.form.description || '',
                time: this.form.time || '09:00',
                duration: parseInt(this.form.duration) || 30,
                tags: Array.isArray(this.form.tags) ? this.form.tags.filter(Boolean) : [],
                isDynamic: this.form.isDynamic || false,
                offsetMinutes: parseInt(this.form.offsetMinutes) || 0,
                subHabits: this.processSubHabits(),
                completed: false,
                expanded: false
            };
            
            if (habitData.isDynamic) {
                habitData.offsetMinutes = Math.max(1, Math.min(1439, habitData.offsetMinutes));
                habitData.effectiveTime = TimeUtils.addMinutesToTime(this.wakeUpTime, habitData.offsetMinutes);
            } else {
                let minutesSinceWake = TimeUtils.getMinutesSinceWake(habitData.time, this.wakeUpTime);
                minutesSinceWake = Math.max(1, Math.min(1439, minutesSinceWake));
                habitData.effectiveTime = TimeUtils.addMinutesToTime(this.wakeUpTime, minutesSinceWake);
                habitData.time = habitData.effectiveTime;
            }
            
            return habitData;
        },

        processSubHabits() {
            if (!Array.isArray(this.form.subHabits)) return [];
            
            return this.form.subHabits.filter(s => s?.title?.trim()).map(s => ({
                id: s.id || Utils.generateId(),
                title: Utils.sanitize(s.title),
                description: s.description || '',
                completed: false
            }));
        },

        updateAfterChange() {
            this.sortByTime();
            this.updateHighlighting();
            this.rebuildTimeline();
            this.calculateAnalytics();
            this.saveData().catch(error => {
                console.error('Error saving data:', error);
            });
        },

        updateHighlighting() {
            try {
                const currentMinutesSinceWake = TimeUtils.getMinutesSinceWake(this.getCurrentTime(), this.wakeUpTime);
                let nextHabit = null;
                let minDiff = Infinity;
                
                this.habits.forEach(habit => {
                    if (!habit.effectiveTime) return;
                    
                    const minutesSinceWake = TimeUtils.getMinutesSinceWake(habit.effectiveTime, this.wakeUpTime);
                    const warningMinutes = Math.max(10, habit.duration || 30);
                    
                    habit.isOverdue = !habit.completed && currentMinutesSinceWake > minutesSinceWake;
                    habit.isCurrent = false;
                    
                    if (!habit.completed) {
                        if (currentMinutesSinceWake > minutesSinceWake) {
                            habit.bgColor = 'rgb(254, 226, 226)';
                        } else if (currentMinutesSinceWake >= minutesSinceWake - warningMinutes) {
                            const progress = (currentMinutesSinceWake - (minutesSinceWake - warningMinutes)) / warningMinutes;
                            const red = Math.round(220 + (254 - 220) * progress);
                            const green = Math.round(252 - (252 - 226) * progress);
                            const blue = Math.round(231 - (231 - 226) * progress);
                            habit.bgColor = `rgb(${red}, ${green}, ${blue})`;
                        } else {
                            habit.bgColor = 'rgb(255, 255, 255)';
                            const diff = minutesSinceWake - currentMinutesSinceWake;
                            if (diff < minDiff) {
                                minDiff = diff;
                                nextHabit = habit;
                            }
                        }
                    } else {
                        habit.bgColor = 'rgb(220, 252, 231)';
                    }
                });
                
                if (nextHabit) {
                    nextHabit.isCurrent = true;
                    nextHabit.bgColor = 'rgb(220, 252, 231)';
                }
            } catch (error) {
                console.error('Update highlighting error:', error);
            }
        },

        setupDragDrop() {
            try {
                const container = document.getElementById('habits-container');
                if (!container || typeof Sortable === 'undefined') return;
                
                if (this.sortableInstance) {
                    this.sortableInstance.destroy();
                }
                
                this.sortableInstance = Sortable.create(container, {
                    handle: '.drag-handle',
                    animation: 0,
                    disabled: true,
                    forceFallback: true
                });
            } catch (error) {
                console.error('Setup drag drop error:', error);
            }
        },

        setupResponsiveHandlers() {
            if (this.resizeObserver) {
                this.resizeObserver.disconnect();
            }
            
            this.resizeObserver = new ResizeObserver(entries => {
                this.updateVisibleRange();
            });
            
            const timeline = this.$refs.timeline;
            if (timeline) {
                this.resizeObserver.observe(timeline);
            }
            
            if (this.hammerInstance) {
                this.hammerInstance.destroy();
            }
            
            if (timeline && typeof Hammer !== 'undefined') {
                this.hammerInstance = new Hammer(timeline);
                this.hammerInstance.get('pan').set({ direction: Hammer.DIRECTION_VERTICAL });
                
                this.hammerInstance.on('panstart', (ev) => {
                    if (ev.target.closest('.drag-handle')) {
                        const habitId = ev.target.closest('.drag-handle').dataset.habitId;
                        this.handleDragStart(habitId, ev.center.y);
                    }
                });
                
                this.hammerInstance.on('panmove', (ev) => {
                    if (this.isDragging) {
                        this.handleDragMove(ev.center.y);
                    }
                });
                
                this.hammerInstance.on('panend', () => {
                    if (this.isDragging) {
                        this.handleDragEnd();
                    }
                });
            }
        },

        closeModal() {
            this.showModal = false;
            this.showMarkdownHelp = false;
            this.editingHabit = null;
            this.form = this.getDefaultForm();
            this.tagInput = '';
            this.lastActiveInput = 'main';
        },

        addTag() {
            const tag = this.tagInput?.trim()?.toLowerCase();
            if (tag && !this.form.tags.includes(tag)) {
                this.form.tags.push(tag);
                this.tagInput = '';
            }
        },

        toggleTagFilter(tag) {
            if (!this.selectedTags) this.selectedTags = [];
            const index = this.selectedTags.indexOf(tag);
            if (index >= 0) {
                this.selectedTags.splice(index, 1);
            } else {
                this.selectedTags.push(tag);
            }
        },

        clearTagFilters() {
            this.selectedTags = [];
        },

        addSubHabit() {
            if (!this.form.subHabits) this.form.subHabits = [];
            this.form.subHabits.push({ id: Utils.generateId(), title: '', description: '', completed: false });
        },

        async wakeUp() {
            this.isAwake = true;
            this.wakeUpTime = this.getCurrentTime();
            
            await this.saveData();
            await this.loadData();
            
            Notifications.scheduleAllHabits(this.habits, this.wakeUpTime);
        },

        endDay() {
            this.calculateSummaryStats();
            this.showSummary = true;
        },

        async goToSleep() {
            this.isAwake = false;
            this.showSummary = false;
            
            await this.saveHistory();
            await this.saveData();
        },

        async saveHistory() {
            try {
                const today = this.currentDate;
                const historyData = {
                    date: today,
                    habits: this.habits.map(h => ({
                        id: h.id,
                        title: h.title,
                        completed: h.completed,
                        effectiveTime: h.effectiveTime,
                        duration: h.duration,
                        tags: h.tags || [],
                        isDynamic: h.isDynamic || false,
                        subHabitsCompleted: (h.subHabits || []).filter(s => s.completed).length,
                        subHabitsTotal: (h.subHabits || []).length
                    })),
                    stats: {
                        completed: this.completedCount,
                        total: this.habits.length,
                        rate: this.progressPercent,
                        wakeUpTime: this.wakeUpTime
                    },
                    dailyStats: this.dailyStats,
                    timestamp: new Date().toISOString()
                };
                
                await Storage.saveHistory(historyData);
                
                const data = await Storage.load();
                if (!data.history) data.history = {};
                data.history[today] = historyData;
                await Storage.save(data);
            } catch (error) {
                console.error('Save history error:', error);
            }
        },

        calculateAnalytics() {
            try {
                this.$nextTick(async () => {
                    const data = await Storage.load();
                    this.streak = Analytics.calculateStreak(data.completions || {}, this.habits.length);
                    this.weeklyRate = Analytics.calculateWeeklyRate(data.completions || {}, this.habits.length);
                    this.dailyStats = Analytics.calculateDailyStats(data, this.habits) || this.getDefaultDailyStats();
                });
            } catch (error) {
                console.error('Calculate analytics error:', error);
            }
        },

        calculateSummaryStats() {
            try {
                if (this.dailyStats) {
                    this.summaryStats = {
                        vsYesterday: this.dailyStats.today.rate - this.dailyStats.yesterday.rate,
                        vsWeek: this.dailyStats.today.rate - this.dailyStats.week.rate
                    };
                }
            } catch (error) {
                console.error('Calculate summary stats error:', error);
                this.summaryStats = { vsYesterday: 0, vsWeek: 0 };
            }
        },

        sortByTime() {
            try {
                this.habits.sort((a, b) => {
                    const aMinutes = TimeUtils.getMinutesSinceWake(a.effectiveTime, this.wakeUpTime);
                    const bMinutes = TimeUtils.getMinutesSinceWake(b.effectiveTime, this.wakeUpTime);
                    return aMinutes - bMinutes;
                });
            } catch (error) {
                console.error('Sort by time error:', error);
            }
        },

        formatTime(timeStr) {
            return TimeUtils.formatTime(timeStr, true);
        },

        parseMarkdown(text) {
            if (!text || typeof window.markdownit === 'undefined') return text || '';
            
            try {
                const md = this.initializeMarkdownParser();
                const processedText = this.preprocessMarkdown(text);
                return md.render(processedText);
            } catch (error) {
                console.error('Markdown parsing error:', error);
                return text || '';
            }
        },
        
        initializeMarkdownParser() {
            const md = window.markdownit({
                html: true,
                breaks: true,
                linkify: true,
                typographer: true
            });
            
            md.renderer.rules.image = this.createImageRenderer();
            
            return md;
        },
        
        createImageRenderer() {
            return function(tokens, idx, options, env, self) {
                const token = tokens[idx];
                const srcIndex = token.attrIndex('src');
                const altIndex = token.attrIndex('alt');
                const titleIndex = token.attrIndex('title');
                
                if (srcIndex < 0) return '';
                
                const src = token.attrs[srcIndex][1];
                const alt = altIndex >= 0 ? token.attrs[altIndex][1] : '';
                const title = titleIndex >= 0 ? token.attrs[titleIndex][1] : '';
                
                return `<a href="${src}" target="_blank" rel="noopener noreferrer" class="inline-block markdown-image-link">
                          <img src="${src}" alt="${alt}" title="${title}" 
                               class="max-w-full h-auto rounded-md cursor-pointer hover:opacity-90 transition-opacity markdown-image" 
                               style="max-height: 300px; object-fit: contain; display: block; margin: 0.5rem 0;" />
                        </a>`;
            };
        },
        
        preprocessMarkdown(text) {
            const videoRegex = /!video\[(.*?)\]\((.*?)\)/g;
            
            return text.replace(videoRegex, (match, alt, url) => {
                const youtubeId = this.getYoutubeId(url);
                const vimeoId = this.getVimeoId(url);
                const imgurId = this.getImgurId(url);
                
                if (youtubeId) {
                    return this.createYouTubeEmbed(youtubeId);
                } else if (vimeoId) {
                    return this.createVimeoEmbed(vimeoId);
                } else if (imgurId) {
                    return this.createImgurVideoEmbed(url);
                }
                
                return this.createGenericVideoEmbed(url);
            });
        },
        
        getYoutubeId(url) {
            const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
            const match = url.match(regExp);
            return (match && match[2].length === 11) ? match[2] : null;
        },
        
        getVimeoId(url) {
            const regExp = /^.*(vimeo\.com\/)((channels\/[A-z]+\/)|(groups\/[A-z]+\/videos\/))?([0-9]+)/;
            const match = url.match(regExp);
            return (match && match[5]) ? match[5] : null;
        },
        
        getImgurId(url) {
            const regExp = /^.*imgur\.com\/([a-zA-Z0-9]+)\.(mp4|webm)$/;
            const match = url.match(regExp);
            return match ? match[1] : null;
        },
        
        createYouTubeEmbed(videoId) {
            return `<div class="video-embed youtube-embed">
                      <iframe width="100%" height="315" 
                              src="https://www.youtube.com/embed/${videoId}" 
                              frameborder="0" 
                              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
                              allowfullscreen></iframe>
                    </div>`;
        },
        
        createVimeoEmbed(videoId) {
            return `<div class="video-embed vimeo-embed">
                      <iframe width="100%" height="315" 
                              src="https://player.vimeo.com/video/${videoId}" 
                              frameborder="0" 
                              allow="autoplay; fullscreen; picture-in-picture" 
                              allowfullscreen></iframe>
                    </div>`;
        },
        
        createImgurVideoEmbed(url) {
            return `<div class="video-embed imgur-embed">
                      <video width="100%" height="auto" controls loop muted preload="metadata">
                        <source src="${url}" type="video/mp4">
                        Your browser does not support the video tag.
                      </video>
                    </div>`;
        },
        
        createGenericVideoEmbed(url) {
            if (url.match(/\.(mp4|webm|ogg)$/i)) {
                return `<div class="video-embed generic-embed">
                          <video width="100%" height="auto" controls preload="metadata">
                            <source src="${url}" type="video/${url.split('.').pop()}">
                            Your browser does not support the video tag.
                          </video>
                        </div>`;
            }
            return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="text-blue-600 hover:text-blue-800 underline">${url}</a>`;
        },
        
        clearAllData() {
            if (confirm('Are you sure you want to delete ALL data? This cannot be undone!')) {
                if (confirm('Really sure? All habits, history, and settings will be permanently deleted.')) {
                    try {
                        localStorage.clear();
                        
                        this.habits = [];
                        this.selectedTags = [];
                        this.isAwake = false;
                        this.wakeUpTime = this.getCurrentTime();
                        this.currentDate = TimeUtils.getDateKey();
                        this.streak = 0;
                        this.weeklyRate = 0;
                        this.dailyStats = this.getDefaultDailyStats();
                        
                        this.updateTimeline();
                        
                        alert('All data has been cleared. The app has been reset to factory settings.');
                    } catch (error) {
                        console.error('Error clearing data:', error);
                        alert('Error clearing data. Please check the console.');
                    }
                }
            }
        },
        
        insertMarkdown(before, after) {
            let targetInput;
            
            if (this.lastActiveInput === 'main') {
                targetInput = this.$refs.mainDescription;
            } else if (this.lastActiveInput.startsWith('sub')) {
                const index = parseInt(this.lastActiveInput.substring(3));
                targetInput = this.$refs[`subDescription${index}`];
            }
            
            if (!targetInput) return;
            
            const start = targetInput.selectionStart;
            const end = targetInput.selectionEnd;
            const text = targetInput.value;
            const selectedText = text.substring(start, end);
            
            let cursorOffset = before.length;
            let insertText = before + selectedText + after;
            
            if (before === '**' && after === '**') {
                if (!selectedText) {
                    cursorOffset = before.length;
                }
            } else if (before === '*' && after === '*') {
                if (!selectedText) {
                    cursorOffset = before.length;
                }
            } else if (before === '__' && after === '__') {
                if (!selectedText) {
                    cursorOffset = before.length;
                }
            } else if (before === '# ' && after === '') {
                cursorOffset = before.length;
            } else if (before.includes('[title]')) {
                cursorOffset = before.length + 1;
            }
            
            const newText = text.substring(0, start) + insertText + text.substring(end);
            
            if (this.lastActiveInput === 'main') {
                this.form.description = newText;
            } else if (this.lastActiveInput.startsWith('sub')) {
                const index = parseInt(this.lastActiveInput.substring(3));
                this.form.subHabits[index].description = newText;
            }
            
            this.$nextTick(() => {
                targetInput.focus();
                const newCursorPos = start + cursorOffset;
                targetInput.setSelectionRange(newCursorPos, newCursorPos);
            });
        }
    }));
});