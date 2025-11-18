# SimuNet

A WebGPU Node Based Procedural Generator focusing on simulations.

[Demo link](https://sagescherrytree.github.io/SimuNet/)

## Concept and Goal

Our concept is very simple; to make a node based procedural tool on WebGPU, because it is simple to access, and runs fast on a GPU. Similar to Houdini, this system would use nodes to spawn geometry, and one can modify them also through node based logic. We propose to use nodes corresponding to compute shaders to act on all the data which is passed through. Parameters, if present, will be exposed via nodes, which is the visual component that the user is able to interact with. WebGPU is also used to render the results of each of the compute shaders, so the user can easily follow what happens in each step of the process, in addition to it being fast as it runs on the GPU. 

## Simulations

SimuNet will be focused on simulations, as its name implies. We will be focusing on implementing the following physics based simulations for the time being.

#### Proposed Simulations

- [*] cloth simulation
- [*] noise based deformation
- [*] rigidbody

We aim to construct the system such that we can easily add in new simulations as compute shaders to modify the input. 

## Milestone 1

[Presentation Link](https://docs.google.com/presentation/d/1P4i5c0qahVdIlbv1cDaszm3CENs7U_gj6FwvsZWp5yE/edit?usp=sharing)

#### Milestone 1 Goals

- [x] Basic node functionality.
- [x] Basic GUI using React.js and Rete.js.
- [x] Renderer to visualise primitives.
- [x] Basic geometry nodes (cube, icosphere, transform).

For Milestone 1, we completed the skeleton for our node network. We used the Rete.js library to construct the node GUI, and we set up the basic renderer.ts pipeline to render cubes and icospheres to the viewport. We also implemented the node connection structure (naive), and transform node which modifies the input geometry. 

## Milestone 2

#### Milestone 2 Goals

- [] Noise and deformation node (GPU).
- [] More base geometries.
- [] Rendering options (basic lambert shader).
- [] Saving/loading node network.

## Milestone 3

#### Milestone 3 Goals

- [] Physics simulation nodes.
- [] Import/export.

# Libraries used

- [Rete.js](https://retejs.org/)
