const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const mongoose = require('mongoose');

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const THEMEALDB_KEY = process.env.THEMEALDB_API_KEY || '1';
const JWT_SECRET = process.env.JWT_SECRET || 'flavorfinder_dev_secret';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/flavorfinder';
const MAX_RECIPES = 20;

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use(express.static(__dirname));

// ─── Mongoose Schemas ─────────────────────────────────────────────────────────
const userSchema = new mongoose.Schema({
  name:     { type: String, required: true, trim: true, maxlength: 30 },
  username: { type: String, required: true, unique: true, trim: true, minlength: 3, maxlength: 30 },
  email:    { type: String, required: true, unique: true, trim: true, lowercase: true },
  passwordHash: { type: String, required: true, select: false },
  favorites: [{ type: String }],  // stores mealdb recipe IDs
}, { timestamps: true });

userSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.passwordHash;
    return ret;
  }
});

const User = mongoose.model('User', userSchema);

// ─── Auth Middleware ──────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  const token = req.cookies?.ff_token;
  if (!token) {
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, error: 'Invalid or expired session' });
  }
}

function setAuthCookie(res, userId) {
  const token = jwt.sign({ userId }, JWT_SECRET, { expiresIn: '7d' });
  res.cookie('ff_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  });
}

// ─── TheMealDB Helper & Normalizer ────────────────────────────────────────────
async function fetchTheMealDB(pathAndQuery) {
  const url = `https://www.themealdb.com/api/json/v1/${THEMEALDB_KEY}${pathAndQuery}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`TheMealDB API error (${response.status})`);
  }
  return await response.json();
}

function parseInstructionsIntoSteps(rawInstructions) {
  if (!rawInstructions || typeof rawInstructions !== 'string') return [];
  const cleanText = rawInstructions.replace(/<[^>]*>/g, '').trim();
  const stepMarkerRegex = /(?:STEP|Step)?\s*\d+[\.:\)]\s*/g;
  const matches = cleanText.split(stepMarkerRegex).map(s => s.trim()).filter(s => s.length > 5);
  if (matches.length >= 2) return matches;
  const lines = cleanText.split(/(?:\r\n|\r|\n)+/).map(l => l.trim()).filter(l => l.length > 5);
  if (lines.length >= 2) return lines;
  const sentences = cleanText.split(/(?<=\.)\s+/).map(s => s.trim()).filter(s => s.length > 5);
  if (sentences.length > 0) return sentences;
  return [cleanText];
}

function normalizeMeal(meal) {
  if (!meal) return null;
  const ingredients = [];
  for (let i = 1; i <= 20; i++) {
    const ing = meal[`strIngredient${i}`];
    const measure = meal[`strMeasure${i}`];
    if (ing && ing.trim()) {
      ingredients.push({ name: ing.trim(), measure: measure ? measure.trim() : '' });
    }
  }
  const steps = parseInstructionsIntoSteps(meal.strInstructions || '');
  return {
    id: meal.idMeal,
    title: meal.strMeal,
    image: meal.strMealThumb || 'https://images.unsplash.com/photo-1495521821757-a1efb6729352?auto=format&fit=crop&w=600&q=80',
    category: meal.strCategory || 'Main',
    area: meal.strArea || 'International',
    instructions: meal.strInstructions || '',
    steps,
    ingredients,
    tags: meal.strTags ? meal.strTags.split(',').map(t => t.trim()) : [],
    youtube: meal.strYoutube || '',
    source: meal.strSource || '',
    servings: 4,
    readyInMinutes: 30
  };
}

function normalizeSearchQuery(value) {
  const normalized = String(value || '').toLowerCase().trim().replace(/\s+/g, ' ');
  const spellingVariants = {
    dhosa: 'dosa',
    dosai: 'dosa',
    biriyani: 'biryani',
    briyani: 'biryani'
  };
  return spellingVariants[normalized] || normalized;
}

function normalizeCuisine(value) {
  const normalized = String(value || '').trim();
  return { Indian: 'India' }[normalized] || normalized;
}

function capitalizeQuery(value) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

function matchesDietFilter(meal, diet) {
  if (!diet || diet.toLowerCase() === 'any') return true;
  const dietLower = diet.toLowerCase();
  const ingredientNames = (meal.ingredients || []).map(i => i.name.toLowerCase()).join(' ');
  // TheMealDB has no diet metadata; this intentionally conservative heuristic only excludes obvious whole-word ingredients.
  const containsIngredient = keywords => keywords.some(keyword => new RegExp(`\\b${keyword}\\b`, 'i').test(ingredientNames));
  const meatKeywords = ['chicken','beef','pork','lamb','mutton','bacon','ham','turkey','fish','salmon','tuna','shrimp','prawn','anchovy','meat','duck','sausage'];
  if (dietLower === 'vegetarian') return !containsIngredient(meatKeywords);
  if (dietLower === 'vegan') {
    const nonVeganKeywords = [...meatKeywords,'milk','cheese','butter','cream','egg','eggs','yogurt','honey','mayonnaise','ghee'];
    return !containsIngredient(nonVeganKeywords);
  }
  if (dietLower === 'gluten free' || dietLower === 'gluten-free' || dietLower === 'keto') {
    const glutenKeywords = ['flour','wheat','pasta','spaghetti','noodles','bread','soy sauce','barley','rye'];
    return !containsIngredient(glutenKeywords);
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// AUTH ROUTES
// ─────────────────────────────────────────────────────────────────────────────

// POST /api/auth/register
app.post('/api/auth/register', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const { name, username, email, password } = req.body;

    if (!name || !username || !email || !password) {
      return res.status(400).json({ success: false, error: 'All fields are required' });
    }
    if (username.length < 3) {
      return res.status(400).json({ success: false, error: 'Username must be at least 3 characters' });
    }
    if (password.length < 6) {
      return res.status(400).json({ success: false, error: 'Password must be at least 6 characters' });
    }

    const normalizedEmail = email.toLowerCase();
    const existingUser = await User.findOne({ $or: [{ email: normalizedEmail }, { username }] });
    if (existingUser) {
      const field = existingUser.email === normalizedEmail ? 'email' : 'username';
      return res.status(409).json({ success: false, error: `This ${field} is already registered` });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = new User({ name, username, email: normalizedEmail, passwordHash, favorites: [] });
    await user.save();
    console.log(`Registered user ${user._id} in ${mongoose.connection.name}.users`);

    setAuthCookie(res, user._id.toString());

    return res.status(201).json({
      success: true,
      user: { id: user._id, name: user.name, username: user.username, email: user.email, favorites: [] }
    });
  } catch (err) {
    console.error('Register error:', err);
    if (err.name === 'MongoServerError') {
      return res.status(503).json({ success: false, error: 'Database unavailable. Please try again.' });
    }
    return res.status(500).json({ success: false, error: 'Registration failed. Please try again.' });
  }
});

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const { identifier, email, password } = req.body;
    const loginIdentifier = (identifier || email || '').trim();
    if (!loginIdentifier || !password) {
      return res.status(400).json({ success: false, error: 'Username or email and password are required' });
    }

    const user = await User.findOne({
      $or: [{ email: loginIdentifier.toLowerCase() }, { username: loginIdentifier }]
    }).select('+passwordHash');
    if (!user) {
      return res.status(401).json({ success: false, error: 'Invalid email or password' });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ success: false, error: 'Invalid email or password' });
    }

    setAuthCookie(res, user._id.toString());

    return res.json({
      success: true,
      user: { id: user._id, name: user.name, username: user.username, email: user.email, favorites: user.favorites }
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ success: false, error: 'Login failed. Please try again.' });
  }
});

// POST /api/auth/logout
app.post('/api/auth/logout', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.clearCookie('ff_token', { httpOnly: true, sameSite: 'lax' });
  return res.json({ success: true, message: 'Logged out successfully' });
});

// GET /api/auth/me
app.get('/api/auth/me', requireAuth, async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const user = await User.findById(req.userId);
    if (!user) {
      res.clearCookie('ff_token');
      return res.status(401).json({ success: false, error: 'User not found' });
    }
    return res.json({
      success: true,
      user: { id: user._id, name: user.name, username: user.username, email: user.email, favorites: user.favorites }
    });
  } catch (err) {
    console.error('Auth/me error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch user' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// FAVORITES ROUTES
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/favorites
app.get('/api/favorites', requireAuth, async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const user = await User.findById(req.userId).select('favorites');
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });
    return res.json({ success: true, favorites: user.favorites });
  } catch (err) {
    console.error('Favorites GET error:', err);
    return res.status(500).json({ success: false, error: 'Failed to load favorites' });
  }
});

// POST /api/favorites/:recipeId  — toggle (add or remove)
app.post('/api/favorites/:recipeId', requireAuth, async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const { recipeId } = req.params;
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });

    const idx = user.favorites.indexOf(recipeId);
    let action;
    if (idx > -1) {
      user.favorites.splice(idx, 1);
      action = 'removed';
    } else {
      user.favorites.push(recipeId);
      action = 'added';
    }
    await user.save();

    return res.json({ success: true, action, favorites: user.favorites });
  } catch (err) {
    console.error('Favorites toggle error:', err);
    return res.status(500).json({ success: false, error: 'Failed to update favorite' });
  }
});

// GET /api/favorites/recipes  — fetch full recipe details for all favorites
app.get('/api/favorites/recipes', requireAuth, async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const user = await User.findById(req.userId).select('favorites');
    if (!user || user.favorites.length === 0) {
      return res.json({ success: true, recipes: [] });
    }

    const results = await Promise.all(
      user.favorites.map(id =>
        fetchTheMealDB(`/lookup.php?i=${id}`)
          .then(d => d.meals && d.meals[0] ? normalizeMeal(d.meals[0]) : null)
          .catch(() => null)
      )
    );

    return res.json({ success: true, recipes: results.filter(Boolean) });
  } catch (err) {
    console.error('Favorites recipes error:', err);
    return res.status(500).json({ success: false, error: 'Failed to load favorite recipes' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// RECIPE ROUTES
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/recipes/search
app.get('/api/recipes/search', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const { query, cuisine, category, diet } = req.query;
    const normalizedQuery = normalizeSearchQuery(query);
    const apiCuisine = normalizeCuisine(cuisine);
    let rawMeals = [];

    if (normalizedQuery) {
      const data = await fetchTheMealDB(`/search.php?s=${encodeURIComponent(normalizedQuery)}`);
      rawMeals = data.meals || [];
      if (apiCuisine) {
        rawMeals = rawMeals.filter(meal => (meal.strArea || '').toLowerCase() === apiCuisine.toLowerCase());
      }
      if (category && category.trim()) {
        rawMeals = rawMeals.filter(meal => (meal.strCategory || '').toLowerCase() === category.trim().toLowerCase());
      }
    } else if (apiCuisine) {
      const data = await fetchTheMealDB(`/filter.php?a=${encodeURIComponent(apiCuisine)}`);
      rawMeals = data.meals || [];
    } else if (category && category.trim()) {
      const data = await fetchTheMealDB(`/filter.php?c=${encodeURIComponent(category.trim())}`);
      rawMeals = data.meals || [];
    } else {
      const data = await fetchTheMealDB('/search.php?s=c');
      rawMeals = data.meals || [];
    }

    if (!rawMeals || rawMeals.length === 0) {
      return res.json({
        success: true,
        recipes: [],
        results: [],
        message: normalizedQuery
          ? `No exact ${capitalizeQuery(normalizedQuery)} recipe was found.`
          : 'No recipes matched the selected filters.'
      });
    }

    const uniqueMeals = Array.from(new Map(rawMeals.map(meal => [meal.idMeal, meal])).values());
    const selectedRawMeals = uniqueMeals.slice(0, MAX_RECIPES);
    const enrichedMeals = await Promise.all(
      selectedRawMeals.map(async m => {
        if (m.strInstructions) return m;
        try {
          const detailData = await fetchTheMealDB(`/lookup.php?i=${m.idMeal}`);
          return detailData.meals ? detailData.meals[0] : m;
        } catch { return m; }
      })
    );

    let normalized = enrichedMeals.map(m => normalizeMeal(m)).filter(Boolean);

    if (apiCuisine) {
      normalized = normalized.filter(m => m.area.toLowerCase() === apiCuisine.toLowerCase());
    }
    if (category && category.trim()) {
      normalized = normalized.filter(m => m.category.toLowerCase() === category.trim().toLowerCase());
    }
    if (diet && diet.trim()) {
      normalized = normalized.filter(m => matchesDietFilter(m, diet.trim()));
    }

    return res.json({ success: true, recipes: normalized, results: normalized });
  } catch (error) {
    console.error('Search endpoint error:', error);
    return res.status(500).json({ success: false, error: 'Unable to fetch recipes' });
  }
});

// GET /api/recipes/random
app.get('/api/recipes/random', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const randomPromises = Array(MAX_RECIPES).fill(0).map(() => fetchTheMealDB('/random.php'));
    const results = await Promise.all(randomPromises);
    const mealsMap = new Map();
    results.forEach(resData => {
      if (resData.meals && resData.meals[0]) {
        const norm = normalizeMeal(resData.meals[0]);
        if (norm) mealsMap.set(norm.id, norm);
      }
    });
    const normalizedList = Array.from(mealsMap.values()).slice(0, MAX_RECIPES);
    return res.json({ success: true, recipes: normalizedList, results: normalizedList });
  } catch (error) {
    console.error('Random recipes error:', error);
    return res.status(500).json({ success: false, error: 'Unable to load random recipes' });
  }
});

// GET /api/recipes/:id
app.get('/api/recipes/:id', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const { id } = req.params;
    const data = await fetchTheMealDB(`/lookup.php?i=${encodeURIComponent(id)}`);
    if (!data.meals || !data.meals[0]) {
      return res.status(404).json({ success: false, error: 'Recipe not found' });
    }
    const recipe = normalizeMeal(data.meals[0]);
    return res.json({ success: true, recipe });
  } catch (error) {
    console.error('Recipe details error:', error);
    return res.status(500).json({ success: false, error: 'Failed to load recipe details' });
  }
});

// ─── API 404 handler ──────────────────────────────────────────────────────────
app.use('/api/*', (req, res) => {
  res.status(404).json({ success: false, error: `API endpoint ${req.originalUrl} not found` });
});

// ─── SPA Fallback ─────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ─── Start Server ─────────────────────────────────────────────────────────────
function startServer(port) {
  const server = app.listen(port, () => {
    console.log(`Server running on port ${port}`);
    console.log(`Open: http://localhost:${port}`);
  });
  server.on('error', error => {
    if (error.code === 'EADDRINUSE') {
      const nextPort = Number(port) + 1;
      console.warn(`Port ${port} is busy; trying ${nextPort} instead.`);
      startServer(nextPort);
      return;
    }
    throw error;
  });
}

async function start() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log(`MongoDB connected: ${mongoose.connection.name}`);
    startServer(PORT);
  } catch (error) {
    console.error(`MongoDB connection failed for ${MONGODB_URI}:`, error.message);
    process.exitCode = 1;
  }
}

start();
