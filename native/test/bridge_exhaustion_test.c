// Bridge allocation failure tests. The bridge is included in this translation
// unit so the test can use small, test-only registry caps without exposing any
// production diagnostics or changing the shipped ABI.
#define B3BRIDGE_MAX_WORLDS 2
#define B3BRIDGE_MAX_BODIES 2
#define B3BRIDGE_MAX_SHAPES 2
#define B3BRIDGE_MAX_JOINTS 2

#include "../bridge.c"

#include <math.h>
#include <stdio.h>

#define CHECK(condition, message)                                                                                              \
	do                                                                                                                           \
	{                                                                                                                            \
		if ( !( condition ) )                                                                                                     \
		{                                                                                                                          \
			fprintf( stderr, "FAIL: %s (%s:%d)\n", ( message ), __FILE__, __LINE__ );                                           \
			return false;                                                                                                           \
		}                                                                                                                          \
	} while ( 0 )

static b3Counters GetCounters( int worldHandle )
{
	return b3World_GetCounters( Bridge_GetWorld( worldHandle ) );
}

static bool TestWorldExhaustion( void )
{
	int initialCount = b3GetWorldCount();
	int worldA = b3bridge_create_world( 0.0f, -10.0f, 0.0f, 1, 0 );
	int worldB = b3bridge_create_world( 0.0f, -10.0f, 0.0f, 1, 0 );
	CHECK( worldA != 0 && worldB != 0, "world registry setup" );
	CHECK( b3GetWorldCount() == initialCount + 2, "world setup count" );

	int failedWorld = b3bridge_create_world( 0.0f, -10.0f, 0.0f, 1, 0 );
	CHECK( failedWorld == 0, "world exhaustion returns zero" );
	CHECK( b3GetWorldCount() == initialCount + 2, "failed world registration rolls back native world" );

	b3bridge_destroy_world( worldA );
	b3bridge_destroy_world( worldB );
	CHECK( b3GetWorldCount() == initialCount, "world teardown count" );
	return true;
}

static bool TestBodyExhaustion( void )
{
	int world = b3bridge_create_world( 0.0f, -10.0f, 0.0f, 1, 0 );
	CHECK( world != 0, "body test world" );

	int bodyA = b3bridge_create_body( world, b3_dynamicBody, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f, 0, 0.0f,
		0.0f, 1.0f );
	int bodyB = b3bridge_create_body( world, b3_dynamicBody, 1.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f, 0, 0.0f,
		0.0f, 1.0f );
	CHECK( bodyA != 0 && bodyB != 0, "body registry setup" );
	b3Counters before = GetCounters( world );

	int failedBody = b3bridge_create_body( world, b3_dynamicBody, 2.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f, 0,
		0.0f, 0.0f, 1.0f );
	CHECK( failedBody == 0, "body exhaustion returns zero" );
	b3Counters after = GetCounters( world );
	CHECK( after.bodyCount == before.bodyCount, "failed body registration rolls back native body" );

	b3bridge_destroy_body( bodyA );
	b3bridge_destroy_body( bodyB );
	b3bridge_destroy_world( world );
	return true;
}

static int AddExhaustedShape( int body, int shapeKind, const float* hullPoints )
{
	switch ( shapeKind )
	{
		case 0:
			return b3bridge_add_box_shape( body, 0.5f, 0.5f, 0.5f, 1.0f, 0.6f, 0.0f, 0.0f );
		case 1:
			return b3bridge_add_sphere_shape( body, 0.5f, 1.0f, 0.6f, 0.0f, 0.0f );
		case 2:
			return b3bridge_add_capsule_shape( body, 0.25f, 0.5f, 1.0f, 0.6f, 0.0f, 0.0f );
		case 3:
			return b3bridge_add_sensor_box_shape( body, 0.5f, 0.5f, 0.5f );
		case 4:
			return b3bridge_add_hull_shape( body, hullPoints, 8, 8, 1.0f, 0.6f, 0.0f, 0.0f );
		default:
			return 0;
	}
}

static bool TestShapeExhaustion( void )
{
	static const float cubePoints[] = {
		-0.5f, -0.5f, -0.5f, 0.5f, -0.5f, -0.5f, -0.5f, 0.5f, -0.5f, 0.5f, 0.5f, -0.5f,
		-0.5f, -0.5f, 0.5f,  0.5f, -0.5f, 0.5f,  -0.5f, 0.5f, 0.5f,  0.5f, 0.5f, 0.5f,
	};

	for ( int shapeKind = 0; shapeKind < 5; ++shapeKind )
	{
		int world = b3bridge_create_world( 0.0f, -10.0f, 0.0f, 1, 0 );
		CHECK( world != 0, "shape test world" );
		int body = b3bridge_create_body( world, b3_dynamicBody, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f, 0,
			0.0f, 0.0f, 1.0f );
		CHECK( body != 0, "shape test body" );
		CHECK( b3bridge_add_sphere_shape( body, 0.5f, 1.0f, 0.6f, 0.0f, 0.0f ) != 0, "shape registry setup A" );
		CHECK( b3bridge_add_sphere_shape( body, 0.25f, 1.0f, 0.6f, 0.0f, 0.0f ) != 0, "shape registry setup B" );

		b3Counters before = GetCounters( world );
		float massBefore = b3bridge_getBodyMass( body );
		int failedShape = AddExhaustedShape( body, shapeKind, cubePoints );
		CHECK( failedShape == 0, "shape exhaustion returns zero" );

		b3Counters after = GetCounters( world );
		CHECK( after.shapeCount == before.shapeCount, "failed shape registration rolls back native shape" );
		CHECK( fabsf( b3bridge_getBodyMass( body ) - massBefore ) < 1.0e-5f, "failed shape leaves body mass unchanged" );

		b3bridge_destroy_body( body );
		b3bridge_destroy_world( world );
	}

	return true;
}

static int AddExhaustedJoint( int world, int bodyA, int bodyB, int jointKind )
{
	switch ( jointKind )
	{
		case 0:
			return b3bridge_create_spherical_joint( world, bodyA, bodyB, 0.0f, 0.0f, 0.0f, 0, 0.0f, 0, 0.0f, 0.0f,
				0.0f, 0.0f, 0, 0.0f, 0.0f, 0.0f, 0.0f );
		case 1:
			return b3bridge_create_revolute_joint( world, bodyA, bodyB, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f, 0, 0.0f,
				0.0f, 0, 0.0f, 0.0f );
		case 2:
			return b3bridge_create_filter_joint( world, bodyA, bodyB );
		case 3:
			return b3bridge_create_distance_joint_ex( world, bodyA, bodyB, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f,
				0.0f, 2.0f, 0, 8.0f, 0.7f, 0 );
		default:
			return 0;
	}
}

static bool TestJointExhaustion( void )
{
	for ( int jointKind = 0; jointKind < 4; ++jointKind )
	{
		int world = b3bridge_create_world( 0.0f, -10.0f, 0.0f, 1, 0 );
		CHECK( world != 0, "joint test world" );
		int bodyA = b3bridge_create_body( world, b3_dynamicBody, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f, 0,
			0.0f, 0.0f, 1.0f );
		int bodyB = b3bridge_create_body( world, b3_dynamicBody, 2.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f, 0,
			0.0f, 0.0f, 1.0f );
		CHECK( bodyA != 0 && bodyB != 0, "joint registry bodies" );
		CHECK( b3bridge_add_sphere_shape( bodyA, 0.25f, 1.0f, 0.6f, 0.0f, 0.0f ) != 0, "joint body shape A" );
		CHECK( b3bridge_add_sphere_shape( bodyB, 0.25f, 1.0f, 0.6f, 0.0f, 0.0f ) != 0, "joint body shape B" );
		CHECK( b3bridge_create_filter_joint( world, bodyA, bodyB ) != 0, "joint registry setup A" );
		CHECK( b3bridge_create_filter_joint( world, bodyA, bodyB ) != 0, "joint registry setup B" );

		b3Counters before = GetCounters( world );
		int failedJoint = AddExhaustedJoint( world, bodyA, bodyB, jointKind );
		CHECK( failedJoint == 0, "joint exhaustion returns zero" );
		b3Counters after = GetCounters( world );
		CHECK( after.jointCount == before.jointCount, "failed joint registration rolls back native joint" );

		b3bridge_destroy_world( world );
	}

	return true;
}

int main( void )
{
	if ( !TestWorldExhaustion() || !TestBodyExhaustion() || !TestShapeExhaustion() || !TestJointExhaustion() )
	{
		return 1;
	}

	puts( "bridge exhaustion tests passed" );
	return 0;
}
