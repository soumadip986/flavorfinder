document.addEventListener('DOMContentLoaded', function () {

    // ═══════════════════════════════════════════════════════
    //  Application State
    // ═══════════════════════════════════════════════════════
    let currentRecipes       = [];
    let selectedRecipe       = null;
    let checkedIngredientsMap = {};   // recipeId → Set of checked ingredient indices
    let currentCookingStep   = 0;
    let currentUser          = null;  // { id, username, email, favorites[] }
    let searchDebounceTimer  = null;
    const recipeCache        = new Map(); // url → {data, timestamp}
    const CACHE_TTL          = 5 * 60 * 1000; // 5 minutes
    const appShell            = document.getElementById('app-shell');
    const authLoading         = document.getElementById('auth-loading');
    const backgroundVideo      = document.querySelector('.background-video');
    backgroundVideo?.setAttribute('playsinline', '');
    const heroSlots            = [1, 2, 3].map(index => document.getElementById(`floating-image-${index}`));
    const heroFallbacks        = [
        'https://www.themealdb.com/images/media/meals/58oia61564916529.jpg',
        'https://www.themealdb.com/images/media/meals/ustsqw1468250014.jpg',
        'https://www.themealdb.com/images/media/meals/qxytrx1511304021.jpg'
    ];
    let heroRecipes            = [];
    let heroSlotIndexes        = [0, 1, 2];
    let heroRotationTimer      = null;
    let nextHeroSlot           = 0;
    const heroImageCache       = new Map();
    const failedHeroImages     = new Set();

    // ═══════════════════════════════════════════════════════
    //  DOM References
    // ═══════════════════════════════════════════════════════

    // Header / Search
    const searchInput       = document.getElementById('search-input');
    const searchBtn         = document.getElementById('search-btn');
    const clearSearchBtn    = document.getElementById('clear-search-btn');
    const cuisineFilter     = document.getElementById('cuisine');
    const mealTypeFilter    = document.getElementById('meal-type');
    const dietFilter        = document.getElementById('diet');
    const clearFiltersBtn   = document.getElementById('clear-filters-btn');
    const resultsContainer  = document.getElementById('results-container');
    const resultsTitle      = document.getElementById('results-title');
    const resultsCount      = document.getElementById('results-count');
    const logoContainer     = document.getElementById('logo-container');

    // Auth UI
    const authButtons       = document.getElementById('auth-buttons');
    const userMenu          = document.getElementById('user-menu');
    const openLoginBtn      = document.getElementById('open-login-btn');
    const openRegisterBtn   = document.getElementById('open-register-btn');
    const userDropdownBtn   = document.getElementById('user-dropdown-btn');
    const userDropdown      = document.getElementById('user-dropdown');
    const userDisplayName   = document.getElementById('user-display-name');
    const dropdownUsername  = document.getElementById('dropdown-username');
    const dropdownEmail     = document.getElementById('dropdown-email');
    const logoutBtn         = document.getElementById('logout-btn');
    const favCountBadge     = document.getElementById('fav-count-badge');
    const favoritesNavBtn   = document.getElementById('favorites-nav-btn');
    const profileBtn        = document.getElementById('profile-btn');
    const profileFavoritesBtn = document.getElementById('profile-favorites-btn');

    // Auth Modal
    const authModal         = document.getElementById('auth-modal');
    const closeAuthBtn      = document.getElementById('close-auth-btn');
    const loginView         = document.getElementById('login-view');
    const registerView      = document.getElementById('register-view');
    const loginForm         = document.getElementById('login-form');
    const registerForm      = document.getElementById('register-form');
    const loginIdentifier   = document.getElementById('login-identifier');
    const loginPassword     = document.getElementById('login-password');
    const loginError        = document.getElementById('login-error');
    const loginSubmitBtn    = document.getElementById('login-submit-btn');
    const registerUsername  = document.getElementById('register-username');
    const registerName      = document.getElementById('register-name');
    const registerEmail     = document.getElementById('register-email');
    const registerPassword  = document.getElementById('register-password');
    const registerConfirmPassword = document.getElementById('register-confirm-password');
    const registerError     = document.getElementById('register-error');
    const registerSubmitBtn = document.getElementById('register-submit-btn');
    const switchToRegister  = document.getElementById('switch-to-register');
    const switchToLogin     = document.getElementById('switch-to-login');

    // Recipe Modal
    const modal                 = document.getElementById('modal');
    const closeModalBtn         = document.getElementById('close-modal-btn');
    const recipeOverviewView    = document.getElementById('recipe-overview-view');
    const recipeCookingView     = document.getElementById('recipe-cooking-view');
    const startCookingBtn       = document.getElementById('start-cooking-btn');
    const exitCookingBtn        = document.getElementById('exit-cooking-btn');
    const modalTitle            = document.getElementById('modal-title');
    const modalImage            = document.getElementById('modal-image');
    const modalSummary          = document.getElementById('modal-summary');
    const modalCuisineTag       = document.getElementById('modal-cuisine-tag');
    const modalCategoryTag      = document.getElementById('modal-category-tag');
    const modalLinksBox         = document.getElementById('modal-links-box');
    const ingredientsList       = document.getElementById('ingredients-list');
    const checklistCounter      = document.getElementById('checklist-counter');
    const instructionsList      = document.getElementById('instructions-list');
    const favToggleBtn          = document.getElementById('fav-toggle-btn');
    const favToggleText         = document.getElementById('fav-toggle-text');
    const cookingRecipeTitle    = document.getElementById('cooking-recipe-title');
    const cookingProgressFill   = document.getElementById('cooking-progress-fill');
    const cookingStepNumber     = document.getElementById('cooking-step-number');
    const cookingStepText       = document.getElementById('cooking-step-text');
    const prevStepBtn           = document.getElementById('prev-step-btn');
    const nextStepBtn           = document.getElementById('next-step-btn');
    const finishRecipeBtn       = document.getElementById('finish-recipe-btn');

    // Favorites Modal
    const favoritesModal      = document.getElementById('favorites-modal');
    const closeFavoritesBtn   = document.getElementById('close-favorites-btn');
    const favRecipesContainer = document.getElementById('fav-recipes-container');
    const favModalSubtitle    = document.getElementById('fav-modal-subtitle');
    const profileModal        = document.getElementById('profile-modal');
    const closeProfileBtn     = document.getElementById('close-profile-btn');
    const profileName         = document.getElementById('profile-name');
    const profileUsername     = document.getElementById('profile-username');
    const profileEmail        = document.getElementById('profile-email');
    const profileFavoritesCount = document.getElementById('profile-favorites-count');

    // Toast
    const toast = document.getElementById('toast');

    // ═══════════════════════════════════════════════════════
    //  Utilities
    // ═══════════════════════════════════════════════════════

    async function fetchJson(url, options = {}) {
        // Simple GET cache
        if (!options.method || options.method === 'GET') {
            const cached = recipeCache.get(url);
            if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
                return cached.data;
            }
        }

        const response = await fetch(url, options);
        const contentType = response.headers.get('content-type') || '';

        if (!contentType.includes('application/json')) {
            const rawText = await response.text();
            if (rawText.trim().startsWith('<')) {
                throw new Error('The recipe API returned HTML instead of JSON. Start the backend with npm run dev and open the reported localhost URL.');
            }
            throw new Error(`Server returned non-JSON response (${response.status})`);
        }

        const data = await response.json();
        if (!response.ok || data.success === false) {
            throw new Error(data.error || data.message || `API Error (${response.status})`);
        }

        if (!options.method || options.method === 'GET') {
            recipeCache.set(url, { data, timestamp: Date.now() });
        }

        return data;
    }

    function showToast(message, type = 'info', durationMs = 3000) {
        toast.textContent = '';
        toast.className = `toast toast-${type}`;

        const icon = document.createElement('i');
        icon.className = type === 'success' ? 'fas fa-check-circle'
                       : type === 'error'   ? 'fas fa-exclamation-circle'
                       : 'fas fa-info-circle';
        toast.appendChild(icon);
        toast.appendChild(document.createTextNode(' ' + message));

        toast.classList.remove('hidden');
        clearTimeout(toast._timer);
        toast._timer = setTimeout(() => toast.classList.add('hidden'), durationMs);
    }

    function capitalize(str) {
        if (!str) return '';
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    function normalizeSearchQuery(value) {
        const normalized = value.toLowerCase().trim().replace(/\s+/g, ' ');
        const spellingVariants = {
            dhosa: 'dosa',
            dosai: 'dosa',
            biriyani: 'biryani',
            briyani: 'biryani'
        };
        return spellingVariants[normalized] || normalized;
    }

    function updateHeroRecipes(recipes) {
        const loadedRecipes = (recipes || [])
            .filter(recipe => recipe.image)
            .map(recipe => ({ name: recipe.title, image: recipe.image }));
        const uniqueImages = new Map(loadedRecipes.map(recipe => [recipe.image, recipe]));
        heroFallbacks.forEach(image => {
            if (!uniqueImages.has(image)) uniqueImages.set(image, { name: 'FlavorFinder recipe', image });
        });
        heroRecipes = Array.from(uniqueImages.values());
        heroSlotIndexes = [0, 1, 2].map(index => index % heroRecipes.length);
        nextHeroSlot = 0;
        heroRecipes.slice(0, 8).forEach(recipe => preloadHeroImage(recipe.image));
        heroSlots.forEach((slot, index) => setHeroImage(slot, heroRecipes[heroSlotIndexes[index]], false));

        if (!heroRotationTimer) {
            heroRotationTimer = setInterval(rotateNextHeroImage, 4500);
        }
    }

    function setHeroImage(slot, recipe, animate = true) {
        if (!slot || !recipe) return;
        const currentLayer = slot.querySelector('.hero-image-current');
        const nextLayer = slot.querySelector('.hero-image-next');
        if (!currentLayer || !nextLayer) return;
        const requestId = (Number(slot.dataset.heroRequestId) || 0) + 1;
        slot.dataset.heroRequestId = requestId;
        slot.setAttribute('aria-label', recipe.name || 'Recipe image');
        preloadHeroImage(recipe.image).then(isLoaded => {
            if (!isLoaded || Number(slot.dataset.heroRequestId) !== requestId) return;
            if (!animate) {
                currentLayer.src = recipe.image;
                currentLayer.alt = recipe.name || 'Recipe image';
                nextLayer.removeAttribute('src');
                return;
            }
            nextLayer.src = recipe.image;
            nextLayer.alt = recipe.name || 'Recipe image';
            nextLayer.classList.add('is-visible');
            window.setTimeout(() => {
                if (Number(slot.dataset.heroRequestId) !== requestId) return;
                currentLayer.src = recipe.image;
                currentLayer.alt = recipe.name || 'Recipe image';
                nextLayer.classList.remove('is-visible');
            }, 650);
        });
    }

    function preloadHeroImage(url) {
        if (heroImageCache.has(url)) return heroImageCache.get(url);
        const promise = new Promise(resolve => {
            const image = new Image();
            image.onload = () => resolve(true);
            image.onerror = () => {
                failedHeroImages.add(url);
                resolve(false);
            };
            image.src = url;
        });
        heroImageCache.set(url, promise);
        return promise;
    }

    function rotateNextHeroImage() {
        if (heroRecipes.length < 3) return;
        const slotIndex = nextHeroSlot;
        const visibleIndexes = new Set(heroSlotIndexes);
        let candidateIndex = (heroSlotIndexes[slotIndex] + 1) % heroRecipes.length;
        let attempts = 0;
        while ((visibleIndexes.has(candidateIndex) || failedHeroImages.has(heroRecipes[candidateIndex].image)) && attempts < heroRecipes.length) {
            candidateIndex = (candidateIndex + 1) % heroRecipes.length;
            attempts += 1;
        }
        if (attempts >= heroRecipes.length) return;
        heroSlotIndexes[slotIndex] = candidateIndex;
        setHeroImage(heroSlots[slotIndex], heroRecipes[candidateIndex]);
        nextHeroSlot = (nextHeroSlot + 1) % heroSlots.length;
    }

    // ═══════════════════════════════════════════════════════
    //  AUTH SYSTEM
    // ═══════════════════════════════════════════════════════

    function renderAuthUI() {
        if (currentUser) {
            authButtons.classList.add('hidden');
            userMenu.classList.remove('hidden');
            userDisplayName.textContent = currentUser.username;
            dropdownUsername.textContent = currentUser.username;
            dropdownEmail.textContent = currentUser.email;
            updateFavBadge();
        } else {
            authButtons.classList.remove('hidden');
            userMenu.classList.add('hidden');
        }
    }

    function updateFavBadge() {
        if (currentUser && currentUser.favorites && currentUser.favorites.length > 0) {
            favCountBadge.textContent = currentUser.favorites.length;
            favCountBadge.classList.remove('hidden');
        } else {
            favCountBadge.classList.add('hidden');
        }
    }

    function enterApplication() {
        authLoading.classList.add('hidden');
        appShell.classList.remove('protected-content');
        authModal.style.display = 'none';
        document.body.style.overflow = 'auto';
    }

    function requireLogin() {
        authLoading.classList.add('hidden');
        appShell.classList.add('protected-content');
        openAuthModal('login');
    }

    async function checkAuthSession() {
        try {
            const data = await fetchJson('/api/auth/me');
            currentUser = data.user;
            renderAuthUI();
            enterApplication();
            // Refresh heart states on visible cards
            refreshCardHearts();
            return true;
        } catch {
            currentUser = null;
            renderAuthUI();
            requireLogin();
            return false;
        }
    }

    function openAuthModal(view = 'login') {
        authModal.style.display = 'block';
        document.body.style.overflow = 'hidden';
        if (view === 'register') {
            loginView.classList.remove('active');
            loginView.classList.add('hidden');
            registerView.classList.remove('hidden');
            registerView.classList.add('active');
        } else {
            registerView.classList.remove('active');
            registerView.classList.add('hidden');
            loginView.classList.remove('hidden');
            loginView.classList.add('active');
        }
        clearAuthErrors();
    }

    function closeAuthModal() {
        authModal.style.display = 'none';
        document.body.style.overflow = 'auto';
        loginForm.reset();
        registerForm.reset();
        clearAuthErrors();
    }

    function clearAuthErrors() {
        loginError.classList.add('hidden');
        loginError.textContent = '';
        registerError.classList.add('hidden');
        registerError.textContent = '';
    }

    function setFormLoading(btn, isLoading, originalText) {
        if (isLoading) {
            btn.classList.add('btn-loading');
            btn.disabled = true;
        } else {
            btn.classList.remove('btn-loading');
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    }

    // Login form submit
    loginForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        const identifier = loginIdentifier.value.trim();
        const password = loginPassword.value;

        if (!identifier || !password) {
            loginError.textContent = 'Please enter your username or email and password.';
            loginError.classList.remove('hidden');
            return;
        }

        const origHTML = loginSubmitBtn.innerHTML;
        setFormLoading(loginSubmitBtn, true, origHTML);
        loginError.classList.add('hidden');

        try {
            const data = await fetchJson('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ identifier, password })
            });
            currentUser = data.user;
            renderAuthUI();
            closeAuthModal();
            enterApplication();
            refreshCardHearts();
            showToast(`Welcome back, ${currentUser.username}!`, 'success');
        } catch (err) {
            loginError.textContent = err.message || 'Login failed. Please try again.';
            loginError.classList.remove('hidden');
        } finally {
            setFormLoading(loginSubmitBtn, false, origHTML);
        }
    });

    // Register form submit
    registerForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        const name = registerName.value.trim();
        const username = registerUsername.value.trim();
        const email = registerEmail.value.trim();
        const password = registerPassword.value;

        if (!name || !username || !email || !password || !registerConfirmPassword.value) {
            registerError.textContent = 'All fields are required.';
            registerError.classList.remove('hidden');
            return;
        }
        if (password !== registerConfirmPassword.value) {
            registerError.textContent = 'Passwords do not match.';
            registerError.classList.remove('hidden');
            return;
        }

        const origHTML = registerSubmitBtn.innerHTML;
        setFormLoading(registerSubmitBtn, true, origHTML);
        registerError.classList.add('hidden');

        try {
            const data = await fetchJson('/api/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, username, email, password })
            });
            currentUser = data.user;
            renderAuthUI();
            closeAuthModal();
            enterApplication();
            showToast(`Account created! Welcome, ${currentUser.username}!`, 'success');
        } catch (err) {
            registerError.textContent = err.message || 'Registration failed. Please try again.';
            registerError.classList.remove('hidden');
        } finally {
            setFormLoading(registerSubmitBtn, false, origHTML);
        }
    });

    // Logout
    logoutBtn.addEventListener('click', async function () {
        userDropdown.classList.add('hidden');
        try {
            await fetchJson('/api/auth/logout', { method: 'POST' });
        } catch { /* ignore */ }
        currentUser = null;
        renderAuthUI();
        refreshCardHearts();
        requireLogin();
        showToast('You have been logged out.', 'info');
    });

    // Header auth button events
    openLoginBtn.addEventListener('click', () => openAuthModal('login'));
    openRegisterBtn.addEventListener('click', () => openAuthModal('register'));
    closeAuthBtn.addEventListener('click', closeAuthModal);
    switchToRegister.addEventListener('click', () => openAuthModal('register'));
    switchToLogin.addEventListener('click', () => openAuthModal('login'));

    // User dropdown toggle
    userDropdownBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        userDropdown.classList.toggle('hidden');
    });

    profileBtn.addEventListener('click', openProfileModal);
    profileFavoritesBtn.addEventListener('click', openFavoritesModal);

    // Password visibility toggles
    document.querySelectorAll('.toggle-password').forEach(btn => {
        btn.addEventListener('click', function () {
            const targetId = this.getAttribute('data-target');
            const input = document.getElementById(targetId);
            if (input.type === 'password') {
                input.type = 'text';
                this.querySelector('i').className = 'fas fa-eye-slash';
            } else {
                input.type = 'password';
                this.querySelector('i').className = 'fas fa-eye';
            }
        });
    });

    // Auth modal backdrop click
    authModal.addEventListener('click', function (e) {
        if (e.target === authModal) closeAuthModal();
    });

    // Close dropdown on outside click
    document.addEventListener('click', function (e) {
        if (!userDropdownBtn.contains(e.target) && !userDropdown.contains(e.target)) {
            userDropdown.classList.add('hidden');
        }
    });

    // ═══════════════════════════════════════════════════════
    //  FAVORITES SYSTEM
    // ═══════════════════════════════════════════════════════

    function isFavorite(recipeId) {
        return currentUser && currentUser.favorites && currentUser.favorites.includes(String(recipeId));
    }

    async function toggleFavorite(recipeId) {
        if (!currentUser) {
            showToast('Please login to save favorites!', 'info');
            openAuthModal('login');
            return;
        }
        try {
            const data = await fetchJson(`/api/favorites/${recipeId}`, { method: 'POST' });
            currentUser.favorites = data.favorites;
            updateFavBadge();
            refreshCardHearts();
            updateModalFavBtn();

            if (data.action === 'added') {
                showToast('Recipe saved to favorites! ❤️', 'success');
            } else {
                showToast('Recipe removed from favorites.', 'info');
            }
        } catch (err) {
            showToast(err.message || 'Failed to update favorite.', 'error');
        }
    }

    function refreshCardHearts() {
        document.querySelectorAll('.card-fav-btn').forEach(btn => {
            const rid = btn.getAttribute('data-id');
            if (isFavorite(rid)) {
                btn.classList.add('is-fav');
                btn.title = 'Remove from favorites';
            } else {
                btn.classList.remove('is-fav');
                btn.title = 'Save to favorites';
            }
        });
    }

    function updateModalFavBtn() {
        if (!selectedRecipe) return;
        const isFav = isFavorite(selectedRecipe.id);
        if (isFav) {
            favToggleBtn.classList.add('is-fav');
            favToggleText.textContent = 'Saved ❤️';
        } else {
            favToggleBtn.classList.remove('is-fav');
            favToggleText.textContent = 'Save Favorite';
        }
    }

    // Favorites nav button
    favoritesNavBtn.addEventListener('click', openFavoritesModal);

    async function openFavoritesModal() {
        if (!currentUser) { openAuthModal('login'); return; }
        favoritesModal.style.display = 'block';
        document.body.style.overflow = 'hidden';
        favRecipesContainer.innerHTML = `
            <div class="fav-empty-state">
                <i class="fas fa-spinner fa-spin"></i>
                <h4>Loading your favorites...</h4>
            </div>`;

        try {
            const data = await fetchJson('/api/favorites/recipes');
            const recipes = data.recipes || [];
            favModalSubtitle.textContent = `${recipes.length} saved recipe${recipes.length !== 1 ? 's' : ''}`;

            if (recipes.length === 0) {
                favRecipesContainer.innerHTML = `
                    <div class="fav-empty-state">
                        <i class="fas fa-heart-broken"></i>
                        <h4>No favorites yet</h4>
                        <p>Click the ♡ heart on any recipe to save it here.</p>
                    </div>`;
                return;
            }

            favRecipesContainer.innerHTML = '';
            recipes.forEach(recipe => {
                const card = document.createElement('div');
                card.className = 'recipe-card';
                card.innerHTML = `
                    <div class="recipe-card-image-wrap">
                        <img src="${recipe.image}" alt="${recipe.title}" class="recipe-card-image" loading="lazy"
                             onerror="this.src='https://images.unsplash.com/photo-1495521821757-a1efb6729352?auto=format&fit=crop&w=600&q=80'">
                        <div class="recipe-badge"><i class="fas fa-utensils"></i> ${recipe.category}</div>
                        <button type="button" class="card-fav-btn is-fav" data-id="${recipe.id}" title="Remove from favorites">
                            <i class="fas fa-heart"></i>
                        </button>
                    </div>
                    <div class="recipe-info">
                        <h3>${recipe.title}</h3>
                        <div class="recipe-card-tags">
                            <span class="area-pill"><i class="fas fa-globe"></i> ${recipe.area}</span>
                            <span class="category-pill"><i class="fas fa-tag"></i> ${recipe.category}</span>
                        </div>
                        <button type="button" class="view-recipe-btn" data-id="${recipe.id}">
                            <i class="fas fa-book-open"></i> View Recipe
                        </button>
                    </div>`;
                favRecipesContainer.appendChild(card);
            });

            // Wire up heart buttons inside favorites modal
            favRecipesContainer.querySelectorAll('.card-fav-btn').forEach(btn => {
                btn.addEventListener('click', async function (e) {
                    e.stopPropagation();
                    const rid = this.getAttribute('data-id');
                    await toggleFavorite(rid);
                    openFavoritesModal();   // refresh list
                });
            });

            // Wire up view recipe buttons
            favRecipesContainer.querySelectorAll('.view-recipe-btn').forEach(btn => {
                btn.addEventListener('click', function () {
                    closeFavoritesModal();
                    openRecipeDetails(this.getAttribute('data-id'));
                });
            });

        } catch (err) {
            favRecipesContainer.innerHTML = `
                <div class="fav-empty-state">
                    <i class="fas fa-exclamation-triangle"></i>
                    <h4>Failed to load favorites</h4>
                    <p>${err.message}</p>
                </div>`;
        }
    }

    function closeFavoritesModal() {
        favoritesModal.style.display = 'none';
        document.body.style.overflow = 'auto';
    }

    function openProfileModal() {
        if (!currentUser) { openAuthModal('login'); return; }
        userDropdown.classList.add('hidden');
        profileName.textContent = currentUser.name || currentUser.username;
        profileUsername.textContent = currentUser.username;
        profileEmail.textContent = currentUser.email;
        profileFavoritesCount.textContent = `${currentUser.favorites?.length || 0} recipe${currentUser.favorites?.length === 1 ? '' : 's'}`;
        profileModal.style.display = 'block';
    }

    function closeProfileModal() {
        profileModal.style.display = 'none';
    }

    closeProfileBtn.addEventListener('click', closeProfileModal);
    profileModal.addEventListener('click', function (e) {
        if (e.target === profileModal) closeProfileModal();
    });

    closeFavoritesBtn.addEventListener('click', closeFavoritesModal);
    favoritesModal.addEventListener('click', function (e) {
        if (e.target === favoritesModal) closeFavoritesModal();
    });

    // ═══════════════════════════════════════════════════════
    //  INITIAL LOAD
    // ═══════════════════════════════════════════════════════
    checkAuthSession().then(isAuthenticated => {
        if (isAuthenticated) fetchInitialRecipes();
    });

    // ═══════════════════════════════════════════════════════
    //  SEARCH EVENT LISTENERS
    // ═══════════════════════════════════════════════════════

    searchBtn.addEventListener('click', handleSearch);
    logoContainer.addEventListener('click', handleLogoClick);

    searchInput.addEventListener('input', function () {
        clearSearchBtn.classList.toggle('hidden', searchInput.value.trim().length === 0);
        // Debounced auto-search
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(() => {
            if (searchInput.value.trim().length >= 2 || searchInput.value.trim().length === 0) {
                handleSearch();
            }
        }, 500);
    });

    clearSearchBtn.addEventListener('click', function () {
        searchInput.value = '';
        clearSearchBtn.classList.add('hidden');
        handleSearch();
    });

    searchInput.addEventListener('keypress', function (e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            clearTimeout(searchDebounceTimer);
            handleSearch();
        }
    });

    [cuisineFilter, mealTypeFilter, dietFilter].forEach(sel => {
        sel.addEventListener('change', function () {
            updateFilterButtonsState();
            handleSearch();
        });
    });

    clearFiltersBtn.addEventListener('click', function () {
        cuisineFilter.value = '';
        mealTypeFilter.value = '';
        dietFilter.value = '';
        updateFilterButtonsState();
        handleSearch();
    });

    // ═══════════════════════════════════════════════════════
    //  SEARCH & FETCH
    // ═══════════════════════════════════════════════════════

    function fetchInitialRecipes() {
        showLoadingState();
        fetchJson('/api/recipes/random')
            .then(data => {
                resultsTitle.textContent = 'Recommended For You';
                displayRecipes(data.recipes || data.results || []);
            })
            .catch(err => {
                console.error('Error fetching initial recipes:', err);
                showErrorState(err.message || 'Unable to load recipes right now. Please try again.');
            });
    }

    function handleSearch() {
        const rawQuery = searchInput.value.trim();
        const query    = normalizeSearchQuery(rawQuery);
        const cuisine  = cuisineFilter.value;
        const category = mealTypeFilter.value;
        const diet     = dietFilter.value;

        showLoadingState();

        if (rawQuery) {
            resultsTitle.textContent = `Results for "${rawQuery}"`;
        } else if (cuisine || category || diet) {
            const parts = [cuisine, category, diet ? capitalize(diet) : ''].filter(Boolean);
            resultsTitle.textContent = `Filtered: ${parts.join(' • ')}`;
        } else {
            resultsTitle.textContent = 'Recommended For You';
        }

        const params = new URLSearchParams();
        if (query)    params.append('query', query);
        if (cuisine)  params.append('cuisine', cuisine);
        if (category) params.append('category', category);
        if (diet)     params.append('diet', diet);

        fetchJson(`/api/recipes/search?${params.toString()}`)
            .then(data => displayRecipes(data.recipes || data.results || []))
            .catch(err => showErrorState(err.message || 'Unable to load recipes. Please try again.'));
    }

    function handleSurpriseMe() {
        showLoadingState();
        resultsTitle.textContent = '🎲 Chef Surprise Selection!';
        fetchJson('/api/recipes/random')
            .then(data => displayRecipes(data.recipes || data.results || []))
            .catch(err => showErrorState('Unable to fetch surprise recipes. Please try again.'));
    }

    function handleLogoClick() {
        searchInput.value = '';
        clearSearchBtn.classList.add('hidden');
        cuisineFilter.value = '';
        mealTypeFilter.value = '';
        dietFilter.value = '';
        updateFilterButtonsState();
        fetchInitialRecipes();
    }

    // ═══════════════════════════════════════════════════════
    //  DISPLAY RECIPES
    // ═══════════════════════════════════════════════════════

    function displayRecipes(recipes) {
        currentRecipes = recipes;
        updateHeroRecipes(recipes);
        resultsContainer.innerHTML = '';

        if (!recipes || recipes.length === 0) {
            showNoResultsState(searchInput.value.trim());
            resultsCount.textContent = '0 recipes found';
            return;
        }

        resultsCount.textContent = `${recipes.length} recipe${recipes.length === 1 ? '' : 's'} found`;

        recipes.forEach(recipe => {
            const card = document.createElement('div');
            card.className = 'recipe-card';

            const imageUrl = recipe.image || 'https://images.unsplash.com/photo-1495521821757-a1efb6729352?auto=format&fit=crop&w=600&q=80';
            const area     = recipe.area || 'International';
            const category = recipe.category || 'Main';
            const isFav    = isFavorite(recipe.id);

            card.innerHTML = `
                <div class="recipe-card-image-wrap">
                    <img src="${imageUrl}" alt="${recipe.title}" class="recipe-card-image" loading="lazy"
                         onerror="this.src='https://images.unsplash.com/photo-1495521821757-a1efb6729352?auto=format&fit=crop&w=600&q=80'">
                    <div class="recipe-badge"><i class="fas fa-utensils"></i> ${category}</div>
                    <button type="button" class="card-fav-btn ${isFav ? 'is-fav' : ''}" data-id="${recipe.id}" title="${isFav ? 'Remove from favorites' : 'Save to favorites'}">
                        <i class="${isFav ? 'fas' : 'far'} fa-heart"></i>
                    </button>
                </div>
                <div class="recipe-info">
                    <h3>${recipe.title}</h3>
                    <div class="recipe-card-tags">
                        <span class="area-pill"><i class="fas fa-globe"></i> ${area}</span>
                        <span class="category-pill"><i class="fas fa-tag"></i> ${category}</span>
                    </div>
                    <button type="button" class="view-recipe-btn" data-id="${recipe.id}">
                        <i class="fas fa-book-open"></i> View Recipe
                    </button>
                </div>`;

            resultsContainer.appendChild(card);
        });

        // Bind heart buttons
        resultsContainer.querySelectorAll('.card-fav-btn').forEach(btn => {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                toggleFavorite(this.getAttribute('data-id'));
            });
        });

        // Bind view buttons
        resultsContainer.querySelectorAll('.view-recipe-btn').forEach(btn => {
            btn.addEventListener('click', function () {
                openRecipeDetails(this.getAttribute('data-id'));
            });
        });
    }

    // ═══════════════════════════════════════════════════════
    //  UI STATES
    // ═══════════════════════════════════════════════════════

    function showLoadingState() {
        resultsCount.textContent = '';
        resultsContainer.innerHTML = Array(6).fill(0).map(() => `
            <div class="recipe-card placeholder">
                <div class="recipe-card-image-wrap animated-bg"></div>
                <div class="recipe-info">
                    <div class="animated-bg animated-bg-text" style="width:80%"></div>
                    <div class="animated-bg animated-bg-text" style="width:50%"></div>
                    <div class="animated-bg animated-bg-text" style="width:100%;height:40px;margin-top:16px"></div>
                </div>
            </div>`).join('');
    }

    function showNoResultsState(query) {
        const label = query ? ` for "${query}"` : '';
        resultsContainer.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-search-minus"></i>
                <h4>No recipes found${label}</h4>
                <p>Try dosa, chicken, biryani, pasta, or pizza. You can also clear the current search and filters.</p>
                <button type="button" id="empty-clear-btn" class="btn btn-primary">
                    <i class="fas fa-undo"></i> Clear Search &amp; Filters
                </button>
            </div>`;
        document.getElementById('empty-clear-btn')?.addEventListener('click', function () {
            searchInput.value = '';
            clearSearchBtn.classList.add('hidden');
            cuisineFilter.value = '';
            mealTypeFilter.value = '';
            dietFilter.value = '';
            updateFilterButtonsState();
            handleSearch();
        });
    }

    function showErrorState(message) {
        resultsCount.textContent = '';
        resultsContainer.innerHTML = `
            <div class="error-state">
                <i class="fas fa-exclamation-triangle"></i>
                <h4>Unable to load recipes right now. Please try again.</h4>
                <p style="font-size:0.85rem;color:#94a3b8;margin-top:4px">${message}</p>
                <button type="button" id="error-retry-btn" class="btn btn-primary" style="margin-top:16px">
                    <i class="fas fa-redo"></i> Try Again
                </button>
            </div>`;
        document.getElementById('error-retry-btn')?.addEventListener('click', fetchInitialRecipes);
    }

    function updateFilterButtonsState() {
        const hasFilters = cuisineFilter.value || mealTypeFilter.value || dietFilter.value;
        clearFiltersBtn.classList.toggle('hidden', !hasFilters);
    }

    // ═══════════════════════════════════════════════════════
    //  RECIPE DETAILS MODAL
    // ═══════════════════════════════════════════════════════

    function openRecipeDetails(recipeId) {
        modal.style.display = 'block';
        document.body.style.overflow = 'hidden';

        recipeOverviewView.classList.add('active');
        recipeOverviewView.classList.remove('hidden');
        recipeCookingView.classList.add('hidden');
        recipeCookingView.classList.remove('active');

        modalTitle.textContent = 'Loading recipe details...';
        modalImage.src = 'https://images.unsplash.com/photo-1495521821757-a1efb6729352?auto=format&fit=crop&w=600&q=80';
        modalSummary.textContent = 'Fetching details...';
        modalLinksBox.innerHTML = '';
        ingredientsList.innerHTML = '<li>Loading ingredients...</li>';
        instructionsList.innerHTML = '<li>Loading instructions...</li>';
        checklistCounter.textContent = '';
        favToggleBtn.classList.add('hidden');

        fetchJson(`/api/recipes/${recipeId}`)
            .then(data => {
                selectedRecipe = data.recipe;
                renderRecipeDetailsModal(selectedRecipe);
            })
            .catch(err => {
                console.error('Error fetching recipe details:', err);
                modalTitle.textContent = 'Error Loading Recipe';
                modalSummary.textContent = 'Failed to load details. Please try again.';
            });
    }

    function renderRecipeDetailsModal(recipe) {
        modalTitle.textContent = recipe.title;
        modalImage.src = recipe.image || 'https://images.unsplash.com/photo-1495521821757-a1efb6729352?auto=format&fit=crop&w=600&q=80';
        modalImage.onerror = function () {
            this.src = 'https://images.unsplash.com/photo-1495521821757-a1efb6729352?auto=format&fit=crop&w=600&q=80';
        };

        modalSummary.innerHTML = `This is a traditional <strong>${recipe.area || 'International'}</strong> dish categorized under <strong>${recipe.category || 'Main'}</strong>.`;
        modalCuisineTag.innerHTML = `<i class="fas fa-globe"></i> ${recipe.area || 'International'}`;
        modalCategoryTag.innerHTML = `<i class="fas fa-utensils"></i> ${recipe.category || 'Main'}`;

        // Favorite toggle button
        favToggleBtn.classList.remove('hidden');
        updateModalFavBtn();

        favToggleBtn.onclick = () => toggleFavorite(recipe.id);

        // External links
        modalLinksBox.innerHTML = '';
        if (recipe.youtube) {
            const ytBtn = document.createElement('a');
            ytBtn.className = 'btn-yt';
            ytBtn.href = recipe.youtube;
            ytBtn.target = '_blank';
            ytBtn.rel = 'noopener';
            ytBtn.innerHTML = '<i class="fab fa-youtube"></i> Watch Video Tutorial';
            modalLinksBox.appendChild(ytBtn);
        }
        if (recipe.source) {
            const srcBtn = document.createElement('a');
            srcBtn.className = 'btn-source';
            srcBtn.href = recipe.source;
            srcBtn.target = '_blank';
            srcBtn.rel = 'noopener';
            srcBtn.innerHTML = '<i class="fas fa-external-link-alt"></i> Original Source';
            modalLinksBox.appendChild(srcBtn);
        }

        renderIngredientsChecklist(recipe);

        instructionsList.innerHTML = '';
        const steps = getActiveSteps(recipe);
        if (steps.length > 0) {
            steps.forEach(stepText => {
                const li = document.createElement('li');
                li.textContent = stepText;
                instructionsList.appendChild(li);
            });
        } else {
            instructionsList.innerHTML = '<li>No instructions provided for this recipe.</li>';
        }
    }

    function renderIngredientsChecklist(recipe) {
        ingredientsList.innerHTML = '';
        if (!recipe.ingredients || recipe.ingredients.length === 0) {
            ingredientsList.innerHTML = '<li>No ingredients listed.</li>';
            checklistCounter.textContent = '0 checked';
            return;
        }

        const recipeId = recipe.id;
        if (!checkedIngredientsMap[recipeId]) checkedIngredientsMap[recipeId] = new Set();
        const checkedSet = checkedIngredientsMap[recipeId];

        recipe.ingredients.forEach((ing, index) => {
            const ingId = index.toString();
            const isChecked = checkedSet.has(ingId);
            const ingredientText = `${ing.measure ? ing.measure + ' ' : ''}${ing.name}`.trim();

            const li = document.createElement('li');
            li.className = `checklist-item ${isChecked ? 'checked' : ''}`;
            li.setAttribute('data-ing-id', ingId);
            li.innerHTML = `
                <div class="custom-checkbox">${isChecked ? '<i class="fas fa-check"></i>' : ''}</div>
                <span class="ingredient-text">${ingredientText}</span>`;

            li.addEventListener('click', function () {
                if (checkedSet.has(ingId)) {
                    checkedSet.delete(ingId);
                    li.classList.remove('checked');
                    li.querySelector('.custom-checkbox').innerHTML = '';
                } else {
                    checkedSet.add(ingId);
                    li.classList.add('checked');
                    li.querySelector('.custom-checkbox').innerHTML = '<i class="fas fa-check"></i>';
                }
                checklistCounter.textContent = `${checkedSet.size}/${recipe.ingredients.length} checked`;
            });

            ingredientsList.appendChild(li);
        });

        checklistCounter.textContent = `${checkedSet.size}/${recipe.ingredients.length} checked`;
    }

    function closeModal() {
        modal.style.display = 'none';
        document.body.style.overflow = 'auto';
    }

    closeModalBtn.addEventListener('click', closeModal);
    modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });

    // ═══════════════════════════════════════════════════════
    //  STEP-BY-STEP COOKING MODE
    // ═══════════════════════════════════════════════════════

    startCookingBtn.addEventListener('click', startCookingMode);
    exitCookingBtn.addEventListener('click', exitCookingMode);
    prevStepBtn.addEventListener('click', goToPrevStep);
    nextStepBtn.addEventListener('click', goToNextStep);
    finishRecipeBtn.addEventListener('click', finishCookingMode);

    function getActiveSteps(recipe = selectedRecipe) {
        if (!recipe) return [];
        return recipe.steps || [];
    }

    function startCookingMode() {
        if (!selectedRecipe) return;
        currentCookingStep = 0;
        recipeOverviewView.classList.add('hidden');
        recipeOverviewView.classList.remove('active');
        recipeCookingView.classList.remove('hidden');
        recipeCookingView.classList.add('active');
        cookingRecipeTitle.textContent = selectedRecipe.title;
        renderActiveCookingStep();
    }

    function exitCookingMode() {
        recipeCookingView.classList.add('hidden');
        recipeCookingView.classList.remove('active');
        recipeOverviewView.classList.remove('hidden');
        recipeOverviewView.classList.add('active');
    }

    function renderActiveCookingStep() {
        const steps = getActiveSteps();
        const totalSteps = steps.length;

        if (totalSteps === 0) {
            cookingStepNumber.textContent = 'STEP 1 OF 1';
            cookingStepText.textContent = 'Follow standard instructions: ' + (selectedRecipe.instructions || 'Prepare and cook according to your preference.');
            cookingProgressFill.style.width = '100%';
            prevStepBtn.disabled = true;
            nextStepBtn.classList.add('hidden');
            finishRecipeBtn.classList.remove('hidden');
            return;
        }

        cookingStepNumber.textContent = `STEP ${currentCookingStep + 1} OF ${totalSteps}`;
        cookingStepText.textContent = steps[currentCookingStep];

        const pct = Math.round(((currentCookingStep + 1) / totalSteps) * 100);
        cookingProgressFill.style.width = `${pct}%`;
        prevStepBtn.disabled = (currentCookingStep === 0);

        if (currentCookingStep === totalSteps - 1) {
            nextStepBtn.classList.add('hidden');
            finishRecipeBtn.classList.remove('hidden');
        } else {
            nextStepBtn.classList.remove('hidden');
            finishRecipeBtn.classList.add('hidden');
        }
    }

    function goToPrevStep() {
        if (currentCookingStep > 0) { currentCookingStep--; renderActiveCookingStep(); }
    }

    function goToNextStep() {
        const steps = getActiveSteps();
        if (currentCookingStep < steps.length - 1) { currentCookingStep++; renderActiveCookingStep(); }
    }

    function finishCookingMode() {
        showToast(`🎉 Congratulations! You finished cooking ${selectedRecipe.title}! Bon Appétit!`, 'success', 5000);
        exitCookingMode();
    }

});