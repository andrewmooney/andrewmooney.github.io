// main.js

const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const boidCountSlider = document.getElementById("boidCount");
const boidCountLabel = document.getElementById("boidCountLabel");
const speedFactorSlider = document.getElementById("speedFactor");
const speedFactorLabel = document.getElementById("speedFactorLabel");

let boidCount = parseInt(boidCountSlider.value);
boidCountLabel.textContent = boidCount;

let speedFactor = parseFloat(speedFactorSlider.value);
speedFactorLabel.textContent = speedFactor.toFixed(1);

let boids = [];

// Resize canvas to full window.
function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
resizeCanvas();
window.addEventListener("resize", resizeCanvas);

// Camera / view transformation state.
let viewOffset = { x: 0, y: 0 };
let zoom = 1.0;

// Mouse interaction state.
let mousePos = { x: 0, y: 0 };
let mouseActive = false; // for repulsion
let isPanning = false;
let lastMousePos = { x: 0, y: 0 };

/* Flocking parameters */
const neighborDist = 50; // how far to look for neighbors
const separationDist = 20; // minimum separation distance
const alignmentWeight = 1.0;
const cohesionWeight = 0.005;
const separationWeight = 1.5;
const repulsionStrength = 1000; // strength of mouse repulsion
const maxSpeed = 5; // maximum boid speed

// Boid class.
class Boid {
  constructor(x, y) {
    // Spawn near (x, y); for a flock, all boids start near the center.
    this.pos = {
      x: x + (Math.random() - 0.5) * 10,
      y: y + (Math.random() - 0.5) * 10,
    };
    // Start with a faster default speed.
    const angle = Math.random() * 2 * Math.PI;
    const speed = Math.random() * 1 + 2; // default speeds are around 2-3
    this.vel = { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed };
    this.radius = 3;
  }

  update(dt) {
    // Multiply delta time by the speedFactor.
    dt *= speedFactor;

    // Flocking behavior:
    let alignment = { x: 0, y: 0 };
    let cohesion = { x: 0, y: 0 };
    let separation = { x: 0, y: 0 };
    let count = 0;

    for (let other of boids) {
      if (other === this) continue;
      const dx = other.pos.x - this.pos.x;
      const dy = other.pos.y - this.pos.y;
      const d = Math.hypot(dx, dy);
      if (d < neighborDist) {
        // Alignment: sum up neighbor velocities.
        alignment.x += other.vel.x;
        alignment.y += other.vel.y;
        // Cohesion: sum up neighbor positions.
        cohesion.x += other.pos.x;
        cohesion.y += other.pos.y;
        count++;
        // Separation: if too close, steer away.
        if (d < separationDist) {
          separation.x -= (other.pos.x - this.pos.x) / d;
          separation.y -= (other.pos.y - this.pos.y) / d;
        }
      }
    }
    if (count > 0) {
      // Average the alignment and cohesion vectors.
      alignment.x /= count;
      alignment.y /= count;
      cohesion.x /= count;
      cohesion.y /= count;
      // Create a vector toward the average position.
      cohesion.x = cohesion.x - this.pos.x;
      cohesion.y = cohesion.y - this.pos.y;

      // Apply weights.
      this.vel.x += alignment.x * alignmentWeight * dt;
      this.vel.y += alignment.y * alignmentWeight * dt;
      this.vel.x += cohesion.x * cohesionWeight * dt;
      this.vel.y += cohesion.y * cohesionWeight * dt;
      this.vel.x += separation.x * separationWeight * dt;
      this.vel.y += separation.y * separationWeight * dt;
    }

    // Mouse repulsion (if left mouse is held).
    if (mouseActive) {
      const worldMouse = screenToWorld(mousePos.x, mousePos.y);
      const dx = this.pos.x - worldMouse.x;
      const dy = this.pos.y - worldMouse.y;
      const d = Math.hypot(dx, dy) || 0.001;
      // Force decays with distance.
      const force = repulsionStrength / (d * d);
      this.vel.x += (dx / d) * force * dt;
      this.vel.y += (dy / d) * force * dt;
    }

    // Limit maximum speed.
    const speed = Math.hypot(this.vel.x, this.vel.y);
    if (speed > maxSpeed) {
      this.vel.x = (this.vel.x / speed) * maxSpeed;
      this.vel.y = (this.vel.y / speed) * maxSpeed;
    }

    // Update position.
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;

    // Wrap around world edges.
    const worldW = canvas.width / zoom;
    const worldH = canvas.height / zoom;
    if (this.pos.x < -worldW / 2) this.pos.x += worldW;
    if (this.pos.x > worldW / 2) this.pos.x -= worldW;
    if (this.pos.y < -worldH / 2) this.pos.y += worldH;
    if (this.pos.y > worldH / 2) this.pos.y -= worldH;
  }

  draw(ctx) {
    ctx.beginPath();
    ctx.arc(this.pos.x, this.pos.y, this.radius, 0, Math.PI * 2);
    ctx.fillStyle = "#66ccff";
    ctx.fill();
  }
}

// Initialize boids so that they spawn in the center.
function initBoids(count) {
  boids = [];
  // Center of the world is at (0,0).
  for (let i = 0; i < count; i++) {
    boids.push(new Boid(0, 0));
  }
}
initBoids(boidCount);

// Convert screen coordinates to world coordinates.
function screenToWorld(x, y) {
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  return {
    x: (x - cx) / zoom - viewOffset.x,
    y: (y - cy) / zoom - viewOffset.y,
  };
}

// Animation loop.
let lastTime = performance.now();
function animate() {
  const now = performance.now();
  const dt = (now - lastTime) / 1000;
  lastTime = now;

  boids.forEach((b) => b.update(dt));

  // Clear canvas.
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.restore();

  // Apply view transformation.
  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.scale(zoom, zoom);
  ctx.translate(viewOffset.x, viewOffset.y);

  boids.forEach((b) => b.draw(ctx));
  ctx.restore();

  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);

// =====================
// Input Event Handlers.
canvas.addEventListener("mousemove", (e) => {
  mousePos.x = e.clientX;
  mousePos.y = e.clientY;
  if (isPanning) {
    const dx = e.clientX - lastMousePos.x;
    const dy = e.clientY - lastMousePos.y;
    viewOffset.x += dx / zoom;
    viewOffset.y += dy / zoom;
    lastMousePos.x = e.clientX;
    lastMousePos.y = e.clientY;
  }
});

canvas.addEventListener("mousedown", (e) => {
  // Left mouse for repulsion.
  if (e.button === 0) {
    mouseActive = true;
  }
  // Middle mouse or Alt+left for panning.
  if (e.button === 1 || (e.button === 0 && e.altKey)) {
    isPanning = true;
    lastMousePos.x = e.clientX;
    lastMousePos.y = e.clientY;
  }
});

canvas.addEventListener("mouseup", (e) => {
  if (e.button === 0) {
    mouseActive = false;
  }
  if (e.button === 1 || (e.button === 0 && e.altKey)) {
    isPanning = false;
  }
});

canvas.addEventListener("wheel", (e) => {
  const zoomFactor = 1.05;
  if (e.deltaY < 0) {
    zoom *= zoomFactor;
  } else {
    zoom /= zoomFactor;
  }
});

boidCountSlider.addEventListener("input", (e) => {
  boidCount = parseInt(e.target.value);
  boidCountLabel.textContent = boidCount;
  initBoids(boidCount);
});

speedFactorSlider.addEventListener("input", (e) => {
  speedFactor = parseFloat(e.target.value);
  speedFactorLabel.textContent = speedFactor.toFixed(1);
});
