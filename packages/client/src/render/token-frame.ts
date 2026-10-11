/**
 * M1-34: the 2D token's ground frame. The token image lies flat (rotated -π/2 about X), so anything
 * authored in that plane (name label and elevation badge anchors) must sit inside a group with this
 * rotation. Outside it, a top-down camera projects those anchors onto the token centre.
 */
export const TOKEN_GROUND_FRAME: readonly [number, number, number] = [-Math.PI / 2, 0, 0];
