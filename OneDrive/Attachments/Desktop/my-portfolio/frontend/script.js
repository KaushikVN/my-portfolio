const API_URL = 'https://my-portfolio-backend-o174.onrender.com/api/projects';

// Fetch and display projects from MongoDB
async function fetchProjects() {
  const container = document.getElementById('projects-container');
  try {
    const response = await fetch(API_URL);
    const projects = await response.json();

    if (!projects || projects.length === 0) {
      container.innerHTML = `
        <div style="grid-column: 1/-1; text-align: center; color: #64748b; padding: 30px;">
          <p>No projects in the database yet. Use the form below to add your first project!</p>
        </div>
      `;
      return;
    }

    container.innerHTML = projects.map(proj => {
      const tags = proj.techStack 
        ? proj.techStack.split(',').map(tag => `<span class="tag">${tag.trim()}</span>`).join('') 
        : '';

      return `
        <div class="project-card">
          <div>
            <h3>${escapeHtml(proj.title)}</h3>
            <p>${escapeHtml(proj.description)}</p>
            <div class="project-tags">${tags}</div>
          </div>
          <a href="${escapeHtml(proj.link)}" target="_blank" class="project-link">View Project &rarr;</a>
        </div>
      `;
    }).join('');
  } catch (error) {
    console.error('Error loading projects:', error);
    container.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; color: #ef4444; padding: 20px; font-weight: 600;">
        Could not connect to backend server.
      </div>
    `;
  }
}

// Handle Add Project Form Submission
document.getElementById('project-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const feedback = document.getElementById('form-feedback');
  const submitBtn = e.target.querySelector('button[type="submit"]');

  const newProject = {
    title: document.getElementById('title').value.trim(),
    description: document.getElementById('description').value.trim(),
    techStack: document.getElementById('techStack').value.trim(),
    link: document.getElementById('link').value.trim()
  };

  submitBtn.disabled = true;
  submitBtn.textContent = 'Saving to Database...';
  feedback.textContent = '';

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newProject)
    });

    if (res.ok) {
      feedback.style.color = '#16a34a';
      feedback.textContent = 'Project saved successfully!';
      document.getElementById('project-form').reset();
      fetchProjects();
    } else {
      feedback.style.color = '#ef4444';
      feedback.textContent = 'Failed to save project. Check console logs.';
    }
  } catch (err) {
    feedback.style.color = '#ef4444';
    feedback.textContent = 'Error connecting to database server.';
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Save Project to Cloud';
  }
});

// Helper to escape HTML characters
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>'"]/g, 
    tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
  );
}

// Initial fetch on page load
fetchProjects();