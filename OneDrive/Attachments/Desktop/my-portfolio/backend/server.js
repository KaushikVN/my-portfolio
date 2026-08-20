const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();

// Enable CORS for all incoming requests
app.use(cors());
app.use(express.json());

// Health-check route
app.get('/', (req, res) => {
  res.send('Portfolio API is running smoothly.');
});

// MongoDB Connection
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error('ERROR: MONGO_URI environment variable is missing.');
}

mongoose
  .connect(MONGO_URI)
  .then(() => console.log('MongoDB Atlas Connected Successfully!'))
  .catch((err) => console.error('MongoDB Atlas Connection Error:', err));

// Schema & Model
const projectSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    description: { type: String, required: true },
    techStack: { type: String, required: true },
    link: { type: String, required: true }
  },
  { timestamps: true }
);

const Project = mongoose.model('Project', projectSchema);

// GET: Fetch all projects
app.get('/api/projects', async (req, res) => {
  try {
    const projects = await Project.find().sort({ createdAt: -1 });
    res.json(projects);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST: Add a new project
app.post('/api/projects', async (req, res) => {
  try {
    const { title, description, techStack, link } = req.body;
    const newProject = new Project({ title, description, techStack, link });
    const savedProject = await newProject.save();
    res.status(201).json(savedProject);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});