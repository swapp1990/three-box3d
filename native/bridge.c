#include "box3d/box3d.h"

#include <math.h>
#include <stdbool.h>
#include <stdint.h>

#define B3BRIDGE_MAX_WORLDS 128
#define B3BRIDGE_MAX_BODIES 8192
#define B3BRIDGE_MAX_SHAPES 16384
#define B3BRIDGE_MAX_JOINTS 8192

typedef struct BridgeWorldSlot
{
	bool active;
	b3WorldId id;
} BridgeWorldSlot;

typedef struct BridgeBodySlot
{
	bool active;
	int worldHandle;
	b3BodyId id;
} BridgeBodySlot;

typedef struct BridgeShapeSlot
{
	bool active;
	int worldHandle;
	int bodyHandle;
	b3ShapeId id;
} BridgeShapeSlot;

typedef struct BridgeJointSlot
{
	bool active;
	int worldHandle;
	b3JointId id;
} BridgeJointSlot;

static BridgeWorldSlot g_worlds[B3BRIDGE_MAX_WORLDS];
static BridgeBodySlot g_bodies[B3BRIDGE_MAX_BODIES];
static BridgeShapeSlot g_shapes[B3BRIDGE_MAX_SHAPES];
static BridgeJointSlot g_joints[B3BRIDGE_MAX_JOINTS];

static bool Bridge_IsFiniteFloat( float value )
{
	return isfinite( value ) != 0;
}

static int Bridge_AllocWorld( b3WorldId id )
{
	for ( int i = 0; i < B3BRIDGE_MAX_WORLDS; ++i )
	{
		if ( g_worlds[i].active == false )
		{
			g_worlds[i].active = true;
			g_worlds[i].id = id;
			return i + 1;
		}
	}

	return 0;
}

static int Bridge_AllocBody( int worldHandle, b3BodyId id )
{
	for ( int i = 0; i < B3BRIDGE_MAX_BODIES; ++i )
	{
		if ( g_bodies[i].active == false )
		{
			g_bodies[i].active = true;
			g_bodies[i].worldHandle = worldHandle;
			g_bodies[i].id = id;
			return i + 1;
		}
	}

	return 0;
}

static int Bridge_AllocShape( int worldHandle, int bodyHandle, b3ShapeId id )
{
	for ( int i = 0; i < B3BRIDGE_MAX_SHAPES; ++i )
	{
		if ( g_shapes[i].active == false )
		{
			g_shapes[i].active = true;
			g_shapes[i].worldHandle = worldHandle;
			g_shapes[i].bodyHandle = bodyHandle;
			g_shapes[i].id = id;
			return i + 1;
		}
	}

	return 0;
}

static int Bridge_AllocJoint( int worldHandle, b3JointId id )
{
	for ( int i = 0; i < B3BRIDGE_MAX_JOINTS; ++i )
	{
		if ( g_joints[i].active == false )
		{
			g_joints[i].active = true;
			g_joints[i].worldHandle = worldHandle;
			g_joints[i].id = id;
			return i + 1;
		}
	}

	return 0;
}

static b3WorldId Bridge_GetWorld( int handle )
{
	if ( handle <= 0 || handle > B3BRIDGE_MAX_WORLDS || g_worlds[handle - 1].active == false )
	{
		return b3_nullWorldId;
	}

	return g_worlds[handle - 1].id;
}

static b3BodyId Bridge_GetBody( int handle )
{
	if ( handle <= 0 || handle > B3BRIDGE_MAX_BODIES || g_bodies[handle - 1].active == false )
	{
		return b3_nullBodyId;
	}

	return g_bodies[handle - 1].id;
}

static b3ShapeId Bridge_GetShape( int handle )
{
	if ( handle <= 0 || handle > B3BRIDGE_MAX_SHAPES || g_shapes[handle - 1].active == false )
	{
		return b3_nullShapeId;
	}

	return g_shapes[handle - 1].id;
}

static b3JointId Bridge_GetJoint( int handle )
{
	if ( handle <= 0 || handle > B3BRIDGE_MAX_JOINTS || g_joints[handle - 1].active == false )
	{
		return b3_nullJointId;
	}

	return g_joints[handle - 1].id;
}

static bool Bridge_SameBodyId( b3BodyId a, b3BodyId b )
{
	return a.index1 == b.index1 && a.world0 == b.world0 && a.generation == b.generation;
}

static bool Bridge_SameShapeId( b3ShapeId a, b3ShapeId b )
{
	return a.index1 == b.index1 && a.world0 == b.world0 && a.generation == b.generation;
}

static int Bridge_FindBodyHandle( b3BodyId id )
{
	if ( B3_IS_NULL( id ) )
	{
		return 0;
	}

	for ( int i = 0; i < B3BRIDGE_MAX_BODIES; ++i )
	{
		if ( g_bodies[i].active && Bridge_SameBodyId( g_bodies[i].id, id ) )
		{
			return i + 1;
		}
	}

	return 0;
}

static int Bridge_BodyHandleFromShape( b3ShapeId shapeId )
{
	if ( B3_IS_NULL( shapeId ) || b3Shape_IsValid( shapeId ) == false )
	{
		return 0;
	}

	return Bridge_FindBodyHandle( b3Shape_GetBody( shapeId ) );
}

static b3ShapeDef Bridge_MakeShapeDef( float density, float friction, float restitution, float rollingResistance )
{
	b3ShapeDef def = b3DefaultShapeDef();
	def.density = density;
	def.baseMaterial.friction = friction;
	def.baseMaterial.restitution = restitution;
	def.baseMaterial.rollingResistance = rollingResistance;
	def.enableContactEvents = true;
	def.enableHitEvents = true;
	// box3d only emits a sensor begin/end event when the VISITOR shape also has
	// enableSensorEvents = true (native src/sensor.c:118). This defaults false on
	// every shape (including non-sensors), so a solid body could never be
	// detected by a sensor unless every regular shape opts in here. Default this
	// on for all regular (non-sensor) shapes created through the bridge — this
	// matches the old app's expectation and box2d v3 behavior, and keeps the
	// bridge simple (no extra opt-in parameter).
	def.enableSensorEvents = true;
	return def;
}

static b3Vec3 Bridge_NormalizeAxis( float x, float y, float z )
{
	float lengthSquared = x * x + y * y + z * z;
	if ( lengthSquared <= 1.0e-8f || isfinite( lengthSquared ) == false )
	{
		return b3Vec3_axisZ;
	}

	float invLength = 1.0f / sqrtf( lengthSquared );
	return (b3Vec3){ x * invLength, y * invLength, z * invLength };
}

static float Bridge_FindApproachSpeed( b3ContactEvents events, b3ShapeId shapeIdA, b3ShapeId shapeIdB )
{
	for ( int i = 0; i < events.hitCount; ++i )
	{
		b3ContactHitEvent* hit = events.hitEvents + i;
		bool sameOrder = Bridge_SameShapeId( hit->shapeIdA, shapeIdA ) && Bridge_SameShapeId( hit->shapeIdB, shapeIdB );
		bool reverseOrder = Bridge_SameShapeId( hit->shapeIdA, shapeIdB ) && Bridge_SameShapeId( hit->shapeIdB, shapeIdA );
		if ( sameOrder || reverseOrder )
		{
			return hit->approachSpeed;
		}
	}

	return 0.0f;
}

int b3bridge_create_world( float gravityX, float gravityY, float gravityZ, int enableSleep, int enableContinuous )
{
	b3WorldDef def = b3DefaultWorldDef();
	def.gravity = (b3Vec3){ gravityX, gravityY, gravityZ };
	def.enableSleep = enableSleep != 0;
	def.enableContinuous = enableContinuous != 0;
	def.workerCount = 1;

	b3WorldId worldId = b3CreateWorld( &def );
	if ( B3_IS_NULL( worldId ) )
	{
		return 0;
	}

	return Bridge_AllocWorld( worldId );
}

void b3bridge_destroy_world( int worldHandle )
{
	b3WorldId worldId = Bridge_GetWorld( worldHandle );
	if ( B3_IS_NULL( worldId ) )
	{
		return;
	}

	b3DestroyWorld( worldId );
	g_worlds[worldHandle - 1].active = false;

	for ( int i = 0; i < B3BRIDGE_MAX_BODIES; ++i )
	{
		if ( g_bodies[i].active && g_bodies[i].worldHandle == worldHandle )
		{
			g_bodies[i].active = false;
		}
	}

	for ( int i = 0; i < B3BRIDGE_MAX_SHAPES; ++i )
	{
		if ( g_shapes[i].active && g_shapes[i].worldHandle == worldHandle )
		{
			g_shapes[i].active = false;
		}
	}

	for ( int i = 0; i < B3BRIDGE_MAX_JOINTS; ++i )
	{
		if ( g_joints[i].active && g_joints[i].worldHandle == worldHandle )
		{
			g_joints[i].active = false;
		}
	}
}

void b3bridge_step( int worldHandle, float dt, int substeps )
{
	b3WorldId worldId = Bridge_GetWorld( worldHandle );
	if ( B3_IS_NULL( worldId ) || dt <= 0.0f )
	{
		return;
	}

	b3World_Step( worldId, dt, substeps > 0 ? substeps : 1 );
}

int b3bridge_create_body( int worldHandle, int type, float x, float y, float z, float qx, float qy, float qz, float qw,
						  int ccd, float linearDamping, float angularDamping, float gravityScale )
{
	b3WorldId worldId = Bridge_GetWorld( worldHandle );
	if ( B3_IS_NULL( worldId ) )
	{
		return 0;
	}

	b3BodyDef def = b3DefaultBodyDef();
	if ( type < b3_staticBody || type > b3_dynamicBody )
	{
		type = b3_dynamicBody;
	}

	def.type = (b3BodyType)type;
	def.position = (b3Pos){ x, y, z };
	def.rotation = (b3Quat){ { qx, qy, qz }, qw };
	def.isBullet = ccd != 0;
	def.linearDamping = linearDamping >= 0.0f && isfinite( linearDamping ) ? linearDamping : 0.0f;
	def.angularDamping = angularDamping >= 0.0f && isfinite( angularDamping ) ? angularDamping : 0.0f;
	def.gravityScale = isfinite( gravityScale ) ? gravityScale : 1.0f;

	b3BodyId bodyId = b3CreateBody( worldId, &def );
	if ( B3_IS_NULL( bodyId ) )
	{
		return 0;
	}

	return Bridge_AllocBody( worldHandle, bodyId );
}

void b3bridge_destroy_body( int bodyHandle )
{
	b3BodyId bodyId = Bridge_GetBody( bodyHandle );
	if ( B3_IS_NULL( bodyId ) )
	{
		return;
	}

	b3DestroyBody( bodyId );
	g_bodies[bodyHandle - 1].active = false;

	for ( int i = 0; i < B3BRIDGE_MAX_SHAPES; ++i )
	{
		if ( g_shapes[i].active && g_shapes[i].bodyHandle == bodyHandle )
		{
			g_shapes[i].active = false;
		}
	}
}

int b3bridge_add_box_shape( int bodyHandle, float hx, float hy, float hz, float density, float friction, float restitution,
							float rollingResistance )
{
	b3BodyId bodyId = Bridge_GetBody( bodyHandle );
	if ( B3_IS_NULL( bodyId ) )
	{
		return 0;
	}

	b3ShapeDef shapeDef = Bridge_MakeShapeDef( density, friction, restitution, rollingResistance );
	b3BoxHull box = b3MakeBoxHull( hx, hy, hz );
	b3ShapeId shapeId = b3CreateHullShape( bodyId, &shapeDef, &box.base );
	return Bridge_AllocShape( g_bodies[bodyHandle - 1].worldHandle, bodyHandle, shapeId );
}

int b3bridge_add_sphere_shape( int bodyHandle, float radius, float density, float friction, float restitution,
							   float rollingResistance )
{
	b3BodyId bodyId = Bridge_GetBody( bodyHandle );
	if ( B3_IS_NULL( bodyId ) )
	{
		return 0;
	}

	b3ShapeDef shapeDef = Bridge_MakeShapeDef( density, friction, restitution, rollingResistance );
	b3Sphere sphere = { b3Vec3_zero, radius };
	b3ShapeId shapeId = b3CreateSphereShape( bodyId, &shapeDef, &sphere );
	return Bridge_AllocShape( g_bodies[bodyHandle - 1].worldHandle, bodyHandle, shapeId );
}

int b3bridge_add_capsule_shape( int bodyHandle, float radius, float halfHeight, float density, float friction, float restitution,
								float rollingResistance )
{
	b3BodyId bodyId = Bridge_GetBody( bodyHandle );
	if ( B3_IS_NULL( bodyId ) )
	{
		return 0;
	}

	b3ShapeDef shapeDef = Bridge_MakeShapeDef( density, friction, restitution, rollingResistance );
	b3Capsule capsule = { { 0.0f, -halfHeight, 0.0f }, { 0.0f, halfHeight, 0.0f }, radius };
	b3ShapeId shapeId = b3CreateCapsuleShape( bodyId, &shapeDef, &capsule );
	return Bridge_AllocShape( g_bodies[bodyHandle - 1].worldHandle, bodyHandle, shapeId );
}

int b3bridge_add_sensor_box_shape( int bodyHandle, float hx, float hy, float hz )
{
	b3BodyId bodyId = Bridge_GetBody( bodyHandle );
	if ( B3_IS_NULL( bodyId ) )
	{
		return 0;
	}

	b3ShapeDef shapeDef = b3DefaultShapeDef();
	shapeDef.density = 0.0f;
	shapeDef.isSensor = true;
	shapeDef.enableSensorEvents = true;

	b3BoxHull box = b3MakeBoxHull( hx, hy, hz );
	b3ShapeId shapeId = b3CreateHullShape( bodyId, &shapeDef, &box.base );
	return Bridge_AllocShape( g_bodies[bodyHandle - 1].worldHandle, bodyHandle, shapeId );
}

void b3bridge_apply_impulse( int bodyHandle, float ix, float iy, float iz, float px, float py, float pz )
{
	b3BodyId bodyId = Bridge_GetBody( bodyHandle );
	if ( B3_IS_NULL( bodyId ) )
	{
		return;
	}

	b3Body_ApplyLinearImpulse( bodyId, (b3Vec3){ ix, iy, iz }, (b3Pos){ px, py, pz }, true );
}

void b3bridge_applyImpulseToCenter( int bodyHandle, float ix, float iy, float iz )
{
	b3BodyId bodyId = Bridge_GetBody( bodyHandle );
	if ( B3_IS_NULL( bodyId ) )
	{
		return;
	}

	b3Body_ApplyLinearImpulseToCenter( bodyId, (b3Vec3){ ix, iy, iz }, true );
}

void b3bridge_set_linear_velocity( int bodyHandle, float vx, float vy, float vz )
{
	b3BodyId bodyId = Bridge_GetBody( bodyHandle );
	if ( B3_IS_NULL( bodyId ) )
	{
		return;
	}

	b3Body_SetLinearVelocity( bodyId, (b3Vec3){ vx, vy, vz } );
}

void b3bridge_set_kinematic_target( int bodyHandle, float x, float y, float z, float qx, float qy, float qz, float qw,
								   float dt )
{
	b3BodyId bodyId = Bridge_GetBody( bodyHandle );
	if ( B3_IS_NULL( bodyId ) || dt <= 0.0f )
	{
		return;
	}

	b3WorldTransform target = { { x, y, z }, { { qx, qy, qz }, qw } };
	b3Body_SetTargetTransform( bodyId, target, dt, true );
}

int b3bridge_create_spherical_joint( int worldHandle, int bodyHandleA, int bodyHandleB, float ax, float ay, float az,
									 int enableConeLimit, float coneAngle, int enableTwistLimit, float lowerTwistAngle,
									 float upperTwistAngle, float springHertz, float springDampingRatio,
									 int enableMotor, float motorVx, float motorVy, float motorVz, float maxMotorTorque )
{
	b3WorldId worldId = Bridge_GetWorld( worldHandle );
	b3BodyId bodyA = Bridge_GetBody( bodyHandleA );
	b3BodyId bodyB = Bridge_GetBody( bodyHandleB );
	if ( B3_IS_NULL( worldId ) || B3_IS_NULL( bodyA ) || B3_IS_NULL( bodyB ) )
	{
		return 0;
	}

	b3Pos anchor = { ax, ay, az };
	b3SphericalJointDef def = b3DefaultSphericalJointDef();
	def.base.bodyIdA = bodyA;
	def.base.bodyIdB = bodyB;
	def.base.localFrameA.p = b3Body_GetLocalPoint( bodyA, anchor );
	def.base.localFrameB.p = b3Body_GetLocalPoint( bodyB, anchor );

	if ( enableConeLimit && coneAngle >= 0.0f )
	{
		def.enableConeLimit = true;
		def.coneAngle = coneAngle;
	}

	if ( enableTwistLimit && lowerTwistAngle <= upperTwistAngle )
	{
		def.enableTwistLimit = true;
		def.lowerTwistAngle = lowerTwistAngle;
		def.upperTwistAngle = upperTwistAngle;
	}

	if ( springHertz > 0.0f )
	{
		def.enableSpring = true;
		def.hertz = springHertz;
		def.dampingRatio = springDampingRatio > 0.0f ? springDampingRatio : 0.7f;
	}

	if ( enableMotor )
	{
		def.enableMotor = true;
		def.motorVelocity = (b3Vec3){ motorVx, motorVy, motorVz };
		def.maxMotorTorque = maxMotorTorque > 0.0f ? maxMotorTorque : 0.0f;
	}

	b3JointId jointId = b3CreateSphericalJoint( worldId, &def );
	return Bridge_AllocJoint( worldHandle, jointId );
}

int b3bridge_create_revolute_joint( int worldHandle, int bodyHandleA, int bodyHandleB, float ax, float ay, float az,
									float hx, float hy, float hz, int enableLimit, float lower, float upper,
									int enableMotor, float motorSpeed, float maxMotorTorque )
{
	b3WorldId worldId = Bridge_GetWorld( worldHandle );
	b3BodyId bodyA = Bridge_GetBody( bodyHandleA );
	b3BodyId bodyB = Bridge_GetBody( bodyHandleB );
	if ( B3_IS_NULL( worldId ) || B3_IS_NULL( bodyA ) || B3_IS_NULL( bodyB ) )
	{
		return 0;
	}

	b3Pos anchor = { ax, ay, az };
	b3Vec3 worldAxis = Bridge_NormalizeAxis( hx, hy, hz );
	b3Vec3 localAxisA = b3Body_GetLocalVector( bodyA, worldAxis );
	b3Vec3 localAxisB = b3Body_GetLocalVector( bodyB, worldAxis );

	b3RevoluteJointDef def = b3DefaultRevoluteJointDef();
	def.base.bodyIdA = bodyA;
	def.base.bodyIdB = bodyB;
	def.base.localFrameA.p = b3Body_GetLocalPoint( bodyA, anchor );
	def.base.localFrameB.p = b3Body_GetLocalPoint( bodyB, anchor );
	def.base.localFrameA.q = b3ComputeQuatBetweenUnitVectors( b3Vec3_axisZ, localAxisA );
	def.base.localFrameB.q = b3ComputeQuatBetweenUnitVectors( b3Vec3_axisZ, localAxisB );

	if ( enableLimit && lower <= upper )
	{
		def.enableLimit = true;
		def.lowerAngle = lower;
		def.upperAngle = upper;
	}

	if ( enableMotor )
	{
		def.enableMotor = true;
		def.motorSpeed = motorSpeed;
		def.maxMotorTorque = maxMotorTorque > 0.0f ? maxMotorTorque : 0.0f;
	}

	b3JointId jointId = b3CreateRevoluteJoint( worldId, &def );
	return Bridge_AllocJoint( worldHandle, jointId );
}

int b3bridge_create_filter_joint( int worldHandle, int bodyHandleA, int bodyHandleB )
{
	b3WorldId worldId = Bridge_GetWorld( worldHandle );
	b3BodyId bodyA = Bridge_GetBody( bodyHandleA );
	b3BodyId bodyB = Bridge_GetBody( bodyHandleB );
	if ( B3_IS_NULL( worldId ) || B3_IS_NULL( bodyA ) || B3_IS_NULL( bodyB ) )
	{
		return 0;
	}

	b3FilterJointDef def = b3DefaultFilterJointDef();
	def.base.bodyIdA = bodyA;
	def.base.bodyIdB = bodyB;

	b3JointId jointId = b3CreateFilterJoint( worldId, &def );
	return Bridge_AllocJoint( worldHandle, jointId );
}

void b3bridge_set_revolute_motor( int jointHandle, int enableMotor, float motorSpeed, float maxMotorTorque )
{
	b3JointId jointId = Bridge_GetJoint( jointHandle );
	if ( B3_IS_NULL( jointId ) )
	{
		return;
	}

	// Match the applyForce/applyImpulse convention ("wakes the body"): a sleeping
	// island is never stepped, so flipping the motor on without waking it would
	// silently do nothing until something else wakes the island.
	if ( enableMotor )
	{
		b3Joint_WakeBodies( jointId );
	}

	b3RevoluteJoint_EnableMotor( jointId, enableMotor != 0 );
	b3RevoluteJoint_SetMotorSpeed( jointId, motorSpeed );
	b3RevoluteJoint_SetMaxMotorTorque( jointId, maxMotorTorque > 0.0f ? maxMotorTorque : 0.0f );
}

void b3bridge_set_spherical_motor( int jointHandle, int enableMotor, float vx, float vy, float vz, float maxMotorTorque )
{
	b3JointId jointId = Bridge_GetJoint( jointHandle );
	if ( B3_IS_NULL( jointId ) )
	{
		return;
	}

	// See b3bridge_set_revolute_motor: wake on enable, mirroring applyForce/applyImpulse.
	if ( enableMotor )
	{
		b3Joint_WakeBodies( jointId );
	}

	b3SphericalJoint_EnableMotor( jointId, enableMotor != 0 );
	b3SphericalJoint_SetMotorVelocity( jointId, (b3Vec3){ vx, vy, vz } );
	b3SphericalJoint_SetMaxMotorTorque( jointId, maxMotorTorque > 0.0f ? maxMotorTorque : 0.0f );
}

int b3bridge_create_distance_joint_ex( int worldHandle, int bodyHandleA, int bodyHandleB, float anchorAx, float anchorAy,
									   float anchorAz, float anchorBx, float anchorBy, float anchorBz, float length,
									   float minLength, float maxLength, int enableSpring, float hertz,
									   float dampingRatio, int enableLimit )
{
	b3WorldId worldId = Bridge_GetWorld( worldHandle );
	b3BodyId bodyA = Bridge_GetBody( bodyHandleA );
	b3BodyId bodyB = Bridge_GetBody( bodyHandleB );
	if ( B3_IS_NULL( worldId ) || B3_IS_NULL( bodyA ) || B3_IS_NULL( bodyB ) )
	{
		return 0;
	}

	b3DistanceJointDef def = b3DefaultDistanceJointDef();
	def.base.bodyIdA = bodyA;
	def.base.bodyIdB = bodyB;
	def.base.localFrameA.p = b3Body_GetLocalPoint( bodyA, (b3Pos){ anchorAx, anchorAy, anchorAz } );
	def.base.localFrameB.p = b3Body_GetLocalPoint( bodyB, (b3Pos){ anchorBx, anchorBy, anchorBz } );
	def.length = length > 0.0f ? length : 0.1f;
	def.enableSpring = enableSpring != 0;
	def.hertz = hertz > 0.0f ? hertz : 8.0f;
	def.dampingRatio = dampingRatio > 0.0f ? dampingRatio : 0.7f;
	if ( enableLimit != 0 && minLength <= maxLength )
	{
		def.enableLimit = true;
		def.minLength = minLength;
		def.maxLength = maxLength;
	}

	b3JointId jointId = b3CreateDistanceJoint( worldId, &def );
	return Bridge_AllocJoint( worldHandle, jointId );
}

void b3bridge_explode( int worldHandle, float x, float y, float z, float radius, float falloff, float impulsePerArea )
{
	b3WorldId worldId = Bridge_GetWorld( worldHandle );
	if ( B3_IS_NULL( worldId ) || radius <= 0.0f )
	{
		return;
	}

	b3ExplosionDef def = b3DefaultExplosionDef();
	def.position = (b3Pos){ x, y, z };
	def.radius = radius;
	def.falloff = falloff > 0.0f ? falloff : 0.0f;
	def.impulsePerArea = impulsePerArea;
	b3World_Explode( worldId, &def );
}

void b3bridge_cast_ray_closest( int worldHandle, float ox, float oy, float oz, float dx, float dy, float dz,
							   float* outHit )
{
	if ( outHit == NULL )
	{
		return;
	}

	outHit[0] = 0.0f;
	outHit[1] = 0.0f;
	outHit[2] = 0.0f;
	outHit[3] = 0.0f;
	outHit[4] = 0.0f;

	b3WorldId worldId = Bridge_GetWorld( worldHandle );
	if ( B3_IS_NULL( worldId ) )
	{
		return;
	}

	b3RayResult result = b3World_CastRayClosest( worldId, (b3Pos){ ox, oy, oz }, (b3Vec3){ dx, dy, dz },
												 b3DefaultQueryFilter() );
	if ( result.hit == false )
	{
		return;
	}

	outHit[0] = 1.0f;
	outHit[1] = (float)Bridge_BodyHandleFromShape( result.shapeId );
	outHit[2] = result.point.x;
	outHit[3] = result.point.y;
	outHit[4] = result.point.z;
}

void b3bridge_set_body_type( int bodyHandle, int type )
{
	b3BodyId bodyId = Bridge_GetBody( bodyHandle );
	if ( B3_IS_NULL( bodyId ) )
	{
		return;
	}

	if ( type < b3_staticBody || type > b3_dynamicBody )
	{
		type = b3_dynamicBody;
	}

	b3Body_SetType( bodyId, (b3BodyType)type );
}

void b3bridge_get_linear_velocity( int bodyHandle, float* outVelocity )
{
	if ( outVelocity == NULL )
	{
		return;
	}

	outVelocity[0] = 0.0f;
	outVelocity[1] = 0.0f;
	outVelocity[2] = 0.0f;

	b3BodyId bodyId = Bridge_GetBody( bodyHandle );
	if ( B3_IS_NULL( bodyId ) )
	{
		return;
	}

	b3Vec3 v = b3Body_GetLinearVelocity( bodyId );
	outVelocity[0] = v.x;
	outVelocity[1] = v.y;
	outVelocity[2] = v.z;
}

void b3bridge_set_awake( int bodyHandle, int awake )
{
	b3BodyId bodyId = Bridge_GetBody( bodyHandle );
	if ( B3_IS_NULL( bodyId ) )
	{
		return;
	}

	b3Body_SetAwake( bodyId, awake != 0 );
}

int b3bridge_get_awake_body_count( int worldHandle )
{
	b3WorldId worldId = Bridge_GetWorld( worldHandle );
	if ( B3_IS_NULL( worldId ) )
	{
		return 0;
	}

	return b3World_GetAwakeBodyCount( worldId );
}

int b3bridge_get_body_count( int worldHandle )
{
	b3WorldId worldId = Bridge_GetWorld( worldHandle );
	if ( B3_IS_NULL( worldId ) )
	{
		return 0;
	}

	return b3World_GetCounters( worldId ).bodyCount;
}

void b3bridge_read_transforms( const int32_t* bodyHandles, int count, float* outTransforms )
{
	for ( int i = 0; i < count; ++i )
	{
		float* out = outTransforms + 7 * i;
		b3BodyId bodyId = Bridge_GetBody( bodyHandles[i] );
		if ( B3_IS_NULL( bodyId ) )
		{
			out[0] = NAN;
			out[1] = NAN;
			out[2] = NAN;
			out[3] = 0.0f;
			out[4] = 0.0f;
			out[5] = 0.0f;
			out[6] = 1.0f;
			continue;
		}

		b3Pos p = b3Body_GetPosition( bodyId );
		b3Quat q = b3Body_GetRotation( bodyId );
		out[0] = (float)p.x;
		out[1] = (float)p.y;
		out[2] = (float)p.z;
		out[3] = q.v.x;
		out[4] = q.v.y;
		out[5] = q.v.z;
		out[6] = q.s;
	}
}

int b3bridge_drain_contact_begin_events( int worldHandle, float* outEvents, int capacity )
{
	b3WorldId worldId = Bridge_GetWorld( worldHandle );
	if ( B3_IS_NULL( worldId ) )
	{
		return 0;
	}

	b3ContactEvents events = b3World_GetContactEvents( worldId );
	int writeCount = events.beginCount < capacity ? events.beginCount : capacity;
	for ( int i = 0; i < writeCount; ++i )
	{
		b3ContactBeginTouchEvent* event = events.beginEvents + i;
		outEvents[3 * i + 0] = (float)Bridge_BodyHandleFromShape( event->shapeIdA );
		outEvents[3 * i + 1] = (float)Bridge_BodyHandleFromShape( event->shapeIdB );
		outEvents[3 * i + 2] = Bridge_FindApproachSpeed( events, event->shapeIdA, event->shapeIdB );
	}

	return events.beginCount;
}

int b3bridge_drain_sensor_events( int worldHandle, float* outEvents, int capacity )
{
	b3WorldId worldId = Bridge_GetWorld( worldHandle );
	if ( B3_IS_NULL( worldId ) )
	{
		return 0;
	}

	b3SensorEvents events = b3World_GetSensorEvents( worldId );
	int writeCount = events.beginCount < capacity ? events.beginCount : capacity;
	for ( int i = 0; i < writeCount; ++i )
	{
		b3SensorBeginTouchEvent* event = events.beginEvents + i;
		outEvents[2 * i + 0] = (float)Bridge_BodyHandleFromShape( event->sensorShapeId );
		outEvents[2 * i + 1] = (float)Bridge_BodyHandleFromShape( event->visitorShapeId );
	}

	return events.beginCount;
}

void b3bridge_destroyJoint( int jointHandle )
{
	b3JointId jointId = Bridge_GetJoint( jointHandle );
	if ( B3_IS_NULL( jointId ) )
	{
		return;
	}

	b3DestroyJoint( jointId, true );
	g_joints[jointHandle - 1].active = false;
}

void b3bridge_setAngularVelocity( int bodyHandle, float x, float y, float z )
{
	b3BodyId bodyId = Bridge_GetBody( bodyHandle );
	if ( B3_IS_NULL( bodyId ) )
	{
		return;
	}

	b3Body_SetAngularVelocity( bodyId, (b3Vec3){ x, y, z } );
}

void b3bridge_getAngularVelocity( int bodyHandle, float* outVelocity )
{
	if ( outVelocity == NULL )
	{
		return;
	}

	outVelocity[0] = 0.0f;
	outVelocity[1] = 0.0f;
	outVelocity[2] = 0.0f;

	b3BodyId bodyId = Bridge_GetBody( bodyHandle );
	if ( B3_IS_NULL( bodyId ) )
	{
		return;
	}

	b3Vec3 v = b3Body_GetAngularVelocity( bodyId );
	outVelocity[0] = v.x;
	outVelocity[1] = v.y;
	outVelocity[2] = v.z;
}

void b3bridge_setLinearDamping( int bodyHandle, float damping )
{
	b3BodyId bodyId = Bridge_GetBody( bodyHandle );
	if ( B3_IS_NULL( bodyId ) || isfinite( damping ) == false || damping < 0.0f )
	{
		return;
	}

	b3Body_SetLinearDamping( bodyId, damping );
}

float b3bridge_getLinearDamping( int bodyHandle )
{
	b3BodyId bodyId = Bridge_GetBody( bodyHandle );
	return B3_IS_NULL( bodyId ) ? 0.0f : b3Body_GetLinearDamping( bodyId );
}

void b3bridge_setAngularDamping( int bodyHandle, float damping )
{
	b3BodyId bodyId = Bridge_GetBody( bodyHandle );
	if ( B3_IS_NULL( bodyId ) || isfinite( damping ) == false || damping < 0.0f )
	{
		return;
	}

	b3Body_SetAngularDamping( bodyId, damping );
}

float b3bridge_getAngularDamping( int bodyHandle )
{
	b3BodyId bodyId = Bridge_GetBody( bodyHandle );
	return B3_IS_NULL( bodyId ) ? 0.0f : b3Body_GetAngularDamping( bodyId );
}

void b3bridge_setGravityScale( int bodyHandle, float scale )
{
	b3BodyId bodyId = Bridge_GetBody( bodyHandle );
	if ( B3_IS_NULL( bodyId ) || isfinite( scale ) == false )
	{
		return;
	}

	b3Body_SetGravityScale( bodyId, scale );
}

float b3bridge_getGravityScale( int bodyHandle )
{
	b3BodyId bodyId = Bridge_GetBody( bodyHandle );
	return B3_IS_NULL( bodyId ) ? 0.0f : b3Body_GetGravityScale( bodyId );
}

float b3bridge_getBodyMass( int bodyHandle )
{
	b3BodyId bodyId = Bridge_GetBody( bodyHandle );
	return B3_IS_NULL( bodyId ) ? 0.0f : b3Body_GetMass( bodyId );
}

void b3bridge_getBodyInertia( int bodyHandle, float* outInertia )
{
	b3BodyId bodyId = Bridge_GetBody( bodyHandle );
	if ( B3_IS_NULL( bodyId ) )
	{
		outInertia[0] = 0.0f;
		outInertia[1] = 0.0f;
		outInertia[2] = 0.0f;
		return;
	}

	b3Matrix3 inertia = b3Body_GetLocalRotationalInertia( bodyId );
	outInertia[0] = inertia.cx.x;
	outInertia[1] = inertia.cy.y;
	outInertia[2] = inertia.cz.z;
}

void b3bridge_setBodyInertia( int bodyHandle, float ixx, float iyy, float izz )
{
	b3BodyId bodyId = Bridge_GetBody( bodyHandle );
	if ( B3_IS_NULL( bodyId ) || isfinite( ixx ) == false || isfinite( iyy ) == false || isfinite( izz ) == false ||
		 ixx <= 0.0f || iyy <= 0.0f || izz <= 0.0f )
	{
		return;
	}

	// Preserve the shape-derived mass and center of mass; only override the
	// local-space diagonal rotational inertia tensor.
	b3MassData massData = b3Body_GetMassData( bodyId );
	massData.inertia = (b3Matrix3){
		{ ixx, 0.0f, 0.0f },
		{ 0.0f, iyy, 0.0f },
		{ 0.0f, 0.0f, izz },
	};
	b3Body_SetMassData( bodyId, massData );

	// SetMassData refreshes Box3D's local inverse tensor but not its cached
	// world-space inverse tensor. Reapply the unchanged transform through the
	// public API so torques and off-center impulses use the override immediately.
	b3Body_SetTransform( bodyId, b3Body_GetPosition( bodyId ), b3Body_GetRotation( bodyId ) );
}

void b3bridge_applyForce( int bodyHandle, float fx, float fy, float fz )
{
	b3BodyId bodyId = Bridge_GetBody( bodyHandle );
	if ( B3_IS_NULL( bodyId ) )
	{
		return;
	}

	b3Body_ApplyForceToCenter( bodyId, (b3Vec3){ fx, fy, fz }, true );
}

void b3bridge_applyForceAt( int bodyHandle, float fx, float fy, float fz, float px, float py, float pz )
{
	b3BodyId bodyId = Bridge_GetBody( bodyHandle );
	if ( B3_IS_NULL( bodyId ) )
	{
		return;
	}

	b3Body_ApplyForce( bodyId, (b3Vec3){ fx, fy, fz }, (b3Pos){ px, py, pz }, true );
}

void b3bridge_applyTorque( int bodyHandle, float tx, float ty, float tz )
{
	b3BodyId bodyId = Bridge_GetBody( bodyHandle );
	if ( B3_IS_NULL( bodyId ) )
	{
		return;
	}

	b3Body_ApplyTorque( bodyId, (b3Vec3){ tx, ty, tz }, true );
}

void b3bridge_setBodyTransform( int bodyHandle, float x, float y, float z, float qx, float qy, float qz, float qw )
{
	b3BodyId bodyId = Bridge_GetBody( bodyHandle );
	if ( B3_IS_NULL( bodyId ) )
	{
		return;
	}

	b3Body_SetTransform( bodyId, (b3Pos){ x, y, z }, (b3Quat){ { qx, qy, qz }, qw } );
}

int b3bridge_getBodyType( int bodyHandle )
{
	b3BodyId bodyId = Bridge_GetBody( bodyHandle );
	if ( B3_IS_NULL( bodyId ) )
	{
		return -1;
	}

	return (int)b3Body_GetType( bodyId );
}

int b3bridge_isBodyAwake( int bodyHandle )
{
	b3BodyId bodyId = Bridge_GetBody( bodyHandle );
	if ( B3_IS_NULL( bodyId ) )
	{
		return 0;
	}

	return b3Body_IsAwake( bodyId ) ? 1 : 0;
}

void b3bridge_setGravity( int worldHandle, float x, float y, float z )
{
	b3WorldId worldId = Bridge_GetWorld( worldHandle );
	if ( B3_IS_NULL( worldId ) )
	{
		return;
	}

	b3World_SetGravity( worldId, (b3Vec3){ x, y, z } );
}

void b3bridge_setShapeFriction( int shapeHandle, float friction )
{
	b3ShapeId shapeId = Bridge_GetShape( shapeHandle );
	if ( B3_IS_NULL( shapeId ) )
	{
		return;
	}

	b3Shape_SetFriction( shapeId, friction );
}

void b3bridge_setShapeRestitution( int shapeHandle, float restitution )
{
	b3ShapeId shapeId = Bridge_GetShape( shapeHandle );
	if ( B3_IS_NULL( shapeId ) )
	{
		return;
	}

	b3Shape_SetRestitution( shapeId, restitution );
}
