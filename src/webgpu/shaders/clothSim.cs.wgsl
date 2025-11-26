// TODO:: Implement cloth simulation code here.

/**
    Joanna's notes.
    Framework Setup
    Using the CIS5600 Mesh Editor Framework with Polar Camera and OpenGL-based renderer
    Particle System
    Each particle has attributes: position, velocity, force, mass, isFixed.
    Grid layout initialized with particles connected by springs.
    Spring System
    Three types of springs: Structural, shear, and bend springs.
    Force calculation using Hooke’s Law:
    F = k * (distance – restLength) * direction 
    k: Spring stiffness
    distance: Current length
    restLength: Original spring length
    Numerical Integration
    Transitioned from Euler integration to Verlet integration for improved numerical stability. Link
    Implementation included:
    Previous position tracking to handle motion.
    Applying forces via acceleration-based updates.
    Collision Handling
    Implemented floor collision detection to prevent particles from falling indefinitely.
    Improved response by adjusting velocity post-collision.
    Rendering and Interaction
    Visualization with particle rendering, spring rendering and triangle-based mesh rendering.
    Implemented mouse-based interaction to allow dragging of individual particles.
    Research Notes
    Physically Based Animation Techniques
    Mass-Spring Systems: Used for both cloth and soft body simulations.
    Implicit vs. Explicit Integration: Explored stability trade-offs.
    Collision Detection: Investigated methods for handling self-collisions and external object interactions.
    SPH Methods for fluid simulation (density estimation, pressure gradients, viscosity).
    Spatial Grids: Used for fast neighbor lookups.
    Numerical Methods
    Implemented Verlet integration to ensure smoother motion.
    Adjusted damping coefficients to prevent perpetual motion.
    Graphics Pipeline
    Optimized VBO updates to handle real-time deformation.
    Implemented OpenGL triangle-based rendering and buffer population.
    Research Notes
    Physically Based Animation Techniques
    Mass-Spring Systems: Used for both cloth and soft body simulations.
    Implicit vs. Explicit Integration: Explored stability trade-offs.
    Collision Detection: Investigated methods for handling self-collisions and external object interactions.
    SPH Methods for fluid simulation (density estimation, pressure gradients, viscosity).
    Spatial Grids: Used for fast neighbor lookups.
    Numerical Methods
    Implemented Verlet integration to ensure smoother motion.
    Adjusted damping coefficients to prevent perpetual motion.
    Graphics Pipeline
    Optimized VBO updates to handle real-time deformation.
    Implemented OpenGL triangle-based rendering and buffer population.
**/