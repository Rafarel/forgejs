/**
 * FORGE.Picking
 * Picking class.
 *
 * Picking object is owned by an object renderer. It draws the object renderer's scene
 * with its children objects with an overriding picking material into a local picking
 * texture (target). ObjectRenderer is responsible of the calling picking render
 * method and should avoid calling it when no objects are pickable and only for active
 * viewport.
 *
 * For performance matters, picking target is downscaled from a factor defined as
 * a class member.
 *
 * A picking material is a simple ShaderMaterial with color and texture uniforms used to
 * assign each object a single color computed from its mesh id. Texture is used to take
 * alpha into account.
 *
 * The picking instance listens to pointer events (click/over) and fetchs the point
 * matching the event coordinates from the picking texture. Picking is then able to
 * get an object id from the color. Object renderer owning the picking is asked for
 * the object once the id is computed.
 *
 * Objects events supported: click, over, out.
 *
 * @constructor FORGE.Picking
 *
 * @param {FORGE.Viewer} viewer - {@link FORGE.Viewer} reference
 * @param {FORGE.PickingInterface} pickingInterface - picking interface object
 * @extends {FORGE.BaseObject}
 */
FORGE.Picking = function(viewer, pickingInterface)
{
    /**
     * Viewer reference
     * @name FORGE.Picking#_viewer
     * @type {FORGE.Viewer}
     * @private
     */
    this._viewer = viewer;

    /**
     * FORGE picking interface
     * Object exposing a scene and pickable objects
     * @name FORGE.Picking#_pickInterface
     * @type {FORGE.PickingInterface}
     * @private
     */
    this._pickingInterface = pickingInterface;

    /**
     * FORGE gaze interface
     * Object exposing a click method when gazing over an object
     * @name FORGE.Picking#_gazeInterface
     * @type {FORGE.GazeInterface}
     * @private
     */
    this._gazeInterface = null;

    /**
     * Hovered object (null if none)
     * @name FORGE.Picking#_hovered
     * @type {FORGE.Object3D}
     * @private
     */
    this._hovered = null;

    /**
     * Picking render target
     * @name FORGE.Picking#_renderTarget
     * @type {THREE.WebGLRenderTarget}
     * @private
     */
    this._renderTarget = null;

    /**
     * Render target down scale factor
     * @name FORGE.Picking#_targetDownScale
     * @type {number}
     * @private
     */
    this._targetDownScale = 1;

    /**
     * Render target minimum height when scaling
     * @name FORGE.Picking#_targetMinHeight
     * @type {number}
     * @private
     */
    this._targetMinHeight = 0;

    /**
     * Ready flag
     * @name FORGE.Picking#_ready
     * @type {boolean}
     * @private
     */
    this._ready = false;

    FORGE.BaseObject.call(this, "Picking");

    this._boot();
};

FORGE.Picking.prototype = Object.create(FORGE.BaseObject.prototype);
FORGE.Picking.prototype.constructor = FORGE.Picking;

FORGE.Picking.DUMP = false;

/**
 * Create a color with unique identifier of an object3D
 * @method FORGE.Picking#colorFromUID
 * @static
 * @return {THREE.Color}
 */
FORGE.Picking.colorFromObjectID = function(id)
{
    if (FORGE.Picking.DUMP === true || this.DUMP === true)
    {
        return new THREE.Color("red");
    }

    return new THREE.Color(id);
};

/**
 * Retrieve object id from color
 * @method FORGE.Picking#_colorTo3DObjectUID
 * @private
 * @static
 * @return {FORGE.Object3D} object id matching the color
 */
FORGE.Picking.colorTo3DObjectID = function(color)
{
    return color.getHex();
};

/**
 * Boot sequence.
 * @method FORGE.Picking#_boot
 * @private
 */
FORGE.Picking.prototype._boot = function()
{
    // Create selection texture with initial size set to one
    // Size will depend on the viewport at render time and will be set accordingly
    this._renderTarget = new THREE.WebGLRenderTarget(1, 1);
    this._renderTarget.name = "Picking RenderTarget";

    // Setup some default values for perfomance/accuracy tradeoff
    // Increase downscale factor and decrease min height will lower picking accuracy
    // but increase performances
    this._targetDownScale = 5;
    this._targetMinHeight = 64;

    this._gazeInterface = new FORGE.GazeInterface(this._click.bind(this));

    this._viewer.story.onSceneLoadComplete.add(this._onSceneLoadComplete, this);
};

/**
 * Scene load complete handler
 * @method FORGE.Picking#_onSceneLoadComplete
 * @private
 */
FORGE.Picking.prototype._onSceneLoadComplete = function()
{
    this._ready = true;
    this._addHandlers();
    this._viewer.onVRChange.add(this._addHandlers, this);
};

/**
 * Add interaction handler
 * @method FORGE.Picking#_addHandlers
 * @private
 */
FORGE.Picking.prototype._addHandlers = function()
{
    this._removeHandlers();

    if (this._viewer.vr === false)
    {
        if (this._viewer.canvas.pointer.onClick.has(this._canvasPointerClickHandler, this) === false)
        {
            this._viewer.canvas.pointer.onClick.add(this._canvasPointerClickHandler, this);
        }

        if (this._viewer.canvas.pointer.onMove.has(this._canvasPointerMoveHandler, this) === false)
        {
            this._viewer.canvas.pointer.onMove.add(this._canvasPointerMoveHandler, this);
        }
    }
};

/**
 * Remove interaction handler
 * @method FORGE.Picking#_removeHandlers
 * @private
 */
FORGE.Picking.prototype._removeHandlers = function()
{
    this._viewer.canvas.pointer.onClick.remove(this._canvasPointerClickHandler, this);
    this._viewer.canvas.pointer.onMove.remove(this._canvasPointerMoveHandler, this);
};

/**
 * Pointer click handler, launch raycasting
 * @method FORGE.Picking#_canvasPointerClickHandler
 * @param {Object} event click event
 * @private
 */
FORGE.Picking.prototype._canvasPointerClickHandler = function(event)
{
    if (this._pickingInterface.enabled === false)
    {
        return;
    }

    var screenPosition = FORGE.Pointer.getRelativeMousePosition(event.data);

    this.log("Pointer click event (" + screenPosition.x + ", " + screenPosition.y + ")");

    var viewport = this._viewer.renderer.activeViewport;
    var viewportPosition = viewport.viewportManager.getRelativeMousePosition(screenPosition);
    var viewportSize = viewport.rectangle.size;

    var pos = viewportPosition.divide(viewportSize.vector2);
    var object = this._getObjectAtNormalizedPosition(pos);
    if (typeof object === "undefined")
    {
        return;
    }

    if (typeof object.click === "function")
    {
        object.click();
    }
};

/**
 * Pointer over handler, launch raycasting
 * @method FORGE.Picking#_canvasPointerMoveHandler
 * @param {Object} event move event
 * @private
 */
FORGE.Picking.prototype._canvasPointerMoveHandler = function(event)
{
    if (this._pickingInterface.enabled === false)
    {
        return;
    }

    var screenPosition = FORGE.Pointer.getRelativeMousePosition(event.data);

    var viewport = this._viewer.renderer.activeViewport;
    var viewportPosition = viewport.viewportManager.getRelativeMousePosition(screenPosition);
    var viewportSize = viewport.rectangle.size;

    this._checkPointerNormalizedSpace(viewportPosition.divide(viewportSize.vector2));
};

/**
 * Get object located at a given normalized set of coordinates
 * @method FORGE.Picking#getObjectAtXnYn
 * @param {THREE.Vector2} posn - normalized position
 * @return {FORGE.Object3D}
 * @private
 */
FORGE.Picking.prototype._getObjectAtNormalizedPosition = function(posn)
{
    var renderer = this._viewer.renderer.webGLRenderer;

    var data = new Uint8Array(4);
    renderer.readRenderTargetPixels(this._renderTarget,
                                    posn.x * this._renderTarget.width,
                                    (1 -  posn.y) * this._renderTarget.height,
                                    1,
                                    1,
                                    data );

    var id = FORGE.Picking.colorTo3DObjectID(new THREE.Color(data[0] / 255, data[1] / 255, data[2] / 255));

    return this._pickingInterface.fnObjectWithId(id);
};

/**
 * Camera change handler
 * @method FORGE.Picking#_checkPointerNormalizedSpace
 * @param {THREE.Vector2} positon - normalized position
 * @private
 */
FORGE.Picking.prototype._checkPointerNormalizedSpace = function(position)
{
    var gaze = this._viewer.renderer.activeViewport.camera.gaze;

    var object = this._getObjectAtNormalizedPosition(position);
    if (typeof object === "undefined" || !object.interactive)
    {
        // Case: one object was hovered and no object is hovered now
        if (this._hovered !== null)
        {
            if (typeof this._hovered.out === "function")
            {
                this._hovered.out();
                this._hovered = null;
            }
        }

        if (this._viewer.vr === true)
        {
            gaze.stop();
        }

        return;
    }

    // Test if hovered object is still the same, if it has changed, call previous out function
    var sameObject = this._hovered === object;
    if (this._hovered !== null && !sameObject)
    {
        if (typeof this._hovered.out === "function")
        {
            this._hovered.out();
        }
    }

    if (!sameObject)
    {
        if (this._viewer.vr === true)
        {
            gaze.start(this._gazeInterface);
        }
    }
    this._hovered = object;

    if (typeof this._hovered.over === "function")
    {
        this._hovered.over();
    }
};

/**
 * Dump picking texture to the scene target
 * @method FORGE.Picking#render
 * @param {THREE.WebGLRenderTarget} target - draw target
 */
FORGE.Picking.prototype._dumpTexture = function(target)
{
    var camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);
    var geometry = new THREE.PlaneBufferGeometry(1, 1);
    var material = new THREE.MeshBasicMaterial({color:new THREE.Color(0xffffff), map: this._renderTarget.texture});
    var quad = new THREE.Mesh(geometry, material);
    quad.position.x = -0.35;
    quad.position.y = 0.35;
    quad.scale.set(0.7, 0.7, 0.7);
    var scene = new THREE.Scene();
    scene.add(quad);

    this._viewer.renderer.webGLRenderer.render(scene, camera, target, false);
};

/**
 * Click object
 * @method FORGE.Picking#_click
 * @private
 */
FORGE.Picking.prototype._click = function()
{
    if (this._hovered === null || typeof this._hovered.click !== "function")
    {
        return;
    }

    this._hovered.click();
};

/**
 * Update routine
 * @method FORGE.Picking#update
 */
FORGE.Picking.prototype.update = function(camera)
{
    if (this._ready === false)
    {
        return;
    }

    var viewport = this._viewer.renderer.activeViewport;
    var view = viewport.view.current;
    var camera = camera || viewport.camera.main;

    // In VR, we need to get VR camera to extract framedata orientation
    // Render will not enable VR to prevent from splitting the picking drawpass
    var cameraVR = this._viewer.renderer.webGLRenderer.vr.getCamera( camera );
    if (cameraVR.isArrayCamera)
    {
        var cameraL = cameraVR.cameras[0];
        camera.matrixWorld.copy(cameraL.matrixWorld);
        camera.matrixWorldInverse.copy(cameraL.matrixWorldInverse);
    }

    var h = FORGE.Math.lowerOrEqualPOT(Math.max(this._targetMinHeight, viewport.rectangle.height / this._targetDownScale));
    var w = FORGE.Math.lowerOrEqualPOT(h * viewport.rectangle.ratio);

    // SetSize won't do anything if size does not change, otherwise it will
    // dispose the internal WebGL texture object and next update will recreate it
    // with the new size stored
    this._renderTarget.setSize(w, h);

    var scene = this._pickingInterface.scene;

    var objectMaterial = this._viewer.renderer.materials.get(view.type, FORGE.ObjectMaterialType.PICK);
    scene.overrideMaterial = objectMaterial.shaderMaterial;

    view.updateUniforms(scene.overrideMaterial.uniforms);


    this._viewer.renderer.webGLRenderer.clearTarget(this._renderTarget, true, true, false);
    this._viewer.renderer.webGLRenderer.render(scene, camera, this._renderTarget, false);

    // Restore scene params
    scene.overrideMaterial = null;

    if (FORGE.Picking.DUMP === true || this.DUMP === true)
    {
        this._dumpTexture(viewport.sceneRenderer.target);
    }

    // When VR is on, we check the center of the screen for each frame
    if (this._viewer.vr === true)
    {
        this._checkPointerNormalizedSpace(new THREE.Vector2(0.5, 0.5));
    }
};

/**
 * Destroy sequence.
 * @method FORGE.Picking#destroy
 */
FORGE.Picking.prototype.destroy = function()
{
    this._gazeInterface = null;

    this._viewer.story.onSceneLoadComplete.remove(this._onSceneLoadComplete, this);
    this._viewer.onVRChange.remove(this._addHandlers, this);
    this._removeHandlers();

    this._renderTarget.dispose();
    this._renderTarget = null;

    this._hovered = null;
    this._pickingInterface = null;
    this._viewer = null;

    FORGE.BaseObject.prototype.destroy.call(this);
};
