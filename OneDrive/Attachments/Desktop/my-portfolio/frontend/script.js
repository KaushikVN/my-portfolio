const API_URL = 'https://my-portfolio-backend-o174.onrender.com/api/projects';

// Fetch and display projects from MongoDB
async function fetchProjects() {
  const container = document.getElementById('projects-container');
  try {
    const response = await fetch(API_URL);
    const projects = await response.json();

    if (!projects || projects.length === 0) {
      container.innerHTML = `
        <div style="grid-column: 1/-1; text-align: center; color: #94a3b8;">
          <p>No projects in the database yet. Use the form below to add your first project!</p>
        </div>
      `;
      return;
    }

    container.innerHTML = projects.map(project => `
      <div class="card">
        <div>
          <div style="display: flex; justify-content: space-between; align-items: flex-start;">
            <h3>${project.title}</h3>
            <button class="delete-btn" onclick="deleteProject('${project._id}')" title="Delete project">&times;</button>
          </div>
          <p>${project.description}</p>
        </div>
        <div>
          <div class="card-tags">
            ${(project.techStack || []).map(tech => `<span class="card-tag">${tech.trim()}</span>`).join('')}
          </div>
          ${project.link ? `<a href="${project.link}" target="_blank" rel="noopener noreferrer">View Project &rarr;</a>` : ''}
        </div>
      </div>
    `).join('');
  } catch (error) {
    console.error('Error fetching projects:', error);
    container.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; color: #ef4444;">
        <p>Could not connect to backend server. Make sure your server is running on port 5000.</p>
      </div>
    `;
  }
}

// Delete a project from MongoDB
async function deleteProject(id) {
  if (!confirm('Are you sure you want to delete this project?')) return;

  try {
    const response = await fetch(`${API_URL}/${id}`, { method: 'DELETE' });
    if (response.ok) {
      fetchProjects(); // Refresh the list
    } else {
      alert('Failed to delete project.');
    }
  } catch (error) {
    console.error('Error deleting project:', error);
    alert('Error connecting to backend.');
  }
}

// Handle Form Submission to add a new project (POST)
const projectForm = document.getElementById('project-form');
projectForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const title = document.getElementById('title').value;
  const description = document.getElementById('description').value;
  const techStack = document.getElementById('techStack').value.split(',');
  const link = document.getElementById('link').value;

  const newProject = { title, description, techStack, link };

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newProject)
    });

    if (response.ok) {
      projectForm.reset();
      fetchProjects();
    } else {
      alert('Failed to save project. Please check backend server.');
    }
  } catch (error) {
    console.error('Error adding project:', error);
    alert('Error connecting to backend.');
  }
});

// Initial load
fetchProjects();