# Articulated physics showcase plan

## What the engine feature protects

An articulated object is a group of bodies connected by joints: a chain, bridge,
crane cable, pendulum, robot arm, or ragdoll. Moving only some of those bodies can
separate the two local anchors of a joint. The solver then receives an impossible
starting pose and reacts with extreme correction forces, endless spinning, or a
visually broken chain.

`applyArticulatedPose` makes a reset or pose change one checked operation:

1. Validate every requested body pose before changing the world.
2. Apply all body transforms as one group.
3. Measure every supplied spherical or revolute joint in world space.
4. Roll the whole group back if any anchors differ by more than the tolerance.
5. Clear both linear and angular velocity by default, then optionally put the
   group to sleep.

This is opt-in because individual `setBodyTransform` calls are still useful for
unconnected bodies. Demos should use the checked operation whenever they reset,
teleport, or load a saved pose for a connected mechanism.

## Five showcases

### 1. Sleeping City wake wave

**What people see:** a wrecking ball crosses a city of thousands of sleeping
bricks. The impact wakes a colored wave through the towers, the city collapses,
and the rubble gradually returns to sleep.

**What it proves:** large body counts are cheap while asleep, wake propagation is
spatially coherent, and a multi-body chain can be safely reset for repeated runs.

**Visible proof:** show bodies, awake bodies, physics-step milliseconds, FPS, and
maximum joint-anchor error. Record an idle baseline, the full collapse, and the
return to the idle baseline in one uncut shot.

### 2. Suspension bridge load test

**What people see:** vehicles or weights cross a bridge made from rigid deck
segments and cables. Increasing the load bends and oscillates the span; an extreme
load causes a controlled collapse.

**What it proves:** many connected bodies, revolute and spherical joints, damping,
mass distribution, and stable reset of a long articulation.

**Visible proof:** overlay current load, midpoint deflection, awake islands,
physics-step time, and maximum joint-anchor error. Provide normal, overloaded, and
reset buttons so viewers can compare runs.

### 3. Port crane and cargo drop

**What people see:** a crane swings a heavy container on a segmented cable, picks
it up, carries it, and releases it onto a destructible stack.

**What it proves:** heavy payload ratios, pendulum motion, continuous collision
detection, kinematic control, and a chain whose terminal payload remains aligned
during pose changes.

**Visible proof:** show payload mass, cable tension proxy, swing angle, joint error,
and step time. Use a wide camera for the crane motion, then cut to a low camera for
the impact.

### 4. Precision pendulum / Newton's cradle lab

**What people see:** a line of suspended balls transfers an impulse from one end
to the other, with slow-motion and repeatable reset controls.

**What it proves:** joint-anchor precision, restitution, damping, fixed-step
determinism, and long-running stability without injected spin.

**Visible proof:** graph total momentum and energy loss beside maximum joint error.
Offer normal speed, slow motion, and repeat-run modes with the same starting pose.

### 5. Robot arm and ragdoll pose switcher

**What people see:** a jointed arm picks up an object, or a mannequin switches from
a saved pose to dynamic simulation and falls naturally.

**What it proves:** the same protection works beyond chains: mixed spherical and
revolute joints, motors, saved poses, interaction, and safe transitions between
controlled and simulated movement.

**Visible proof:** show target pose, motor state, joint error, awake body count, and
step time. Include a deliberately invalid developer-only pose that the engine
rejects and rolls back, while the public demo only exposes valid poses.

## Recommended rollout

1. Finish Sleeping City first because it already exists and is the strongest
   performance story.
2. Build the crane next by reusing the validated chain and payload code.
3. Add the bridge for a second large, cinematic destruction scene.
4. Add the pendulum lab as a compact technical accuracy proof.
5. Add the robot/ragdoll scene to show that the API is general, not chain-specific.

For every public capture, use a stable wide camera, keep the complete cause and
effect in frame, and retain the HUD long enough to read the idle, active, and
settled measurements. A short dramatic edit can be made afterward, but the uncut
technical capture is the proof.
