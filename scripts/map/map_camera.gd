## Camera controller for map panning and zooming.
## Attach to Camera2D node or use as autoload.
extends Camera2D

const PAN_SPEED: float = 800.0
const ZOOM_SPEED: float = 0.1
const MIN_ZOOM: float = 0.02
const MAX_ZOOM: float = 2.0

var _dragging: bool = false
var _drag_start: Vector2 = Vector2.ZERO


func _process(delta: float) -> void:
	_handle_keyboard_pan(delta)


func _unhandled_input(event: InputEvent) -> void:
	# Mouse wheel zoom
	if event is InputEventMouseButton:
		if event.pressed:
			if event.button_index == MOUSE_BUTTON_WHEEL_UP:
				_zoom_at(event.global_position, ZOOM_SPEED)
			elif event.button_index == MOUSE_BUTTON_WHEEL_DOWN:
				_zoom_at(event.global_position, -ZOOM_SPEED)
			elif event.button_index == MOUSE_BUTTON_MIDDLE:
				_dragging = true
				_drag_start = event.global_position
		else:
			if event.button_index == MOUSE_BUTTON_MIDDLE:
				_dragging = false

	# Middle-mouse drag to pan
	if event is InputEventMouseMotion and _dragging:
		var delta_pos: Vector2 = (_drag_start - event.global_position) / zoom
		position += delta_pos
		_drag_start = event.global_position


func _handle_keyboard_pan(delta: float) -> void:
	var pan_dir := Vector2.ZERO
	if Input.is_action_pressed("pan_left"):
		pan_dir.x -= 1
	if Input.is_action_pressed("pan_right"):
		pan_dir.x += 1
	if Input.is_action_pressed("pan_up"):
		pan_dir.y -= 1
	if Input.is_action_pressed("pan_down"):
		pan_dir.y += 1

	if pan_dir != Vector2.ZERO:
		position += pan_dir.normalized() * PAN_SPEED * delta / zoom.x


func _zoom_at(mouse_screen_pos: Vector2, factor: float) -> void:
	var old_zoom := zoom
	var new_zoom_val := clampf(zoom.x + factor * zoom.x, MIN_ZOOM, MAX_ZOOM)
	var new_zoom := Vector2(new_zoom_val, new_zoom_val)

	# Zoom toward mouse position
	var viewport_size := get_viewport_rect().size
	var mouse_offset := mouse_screen_pos - viewport_size / 2.0
	position += mouse_offset * (1.0 / old_zoom.x - 1.0 / new_zoom.x)

	zoom = new_zoom
