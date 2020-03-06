import {
    glTF,
    glTFAccessor,
    glTFAnimation,
    glTFAnimationChannel,
    glTFAnimationSampler,
    glTFImage,
    glTFMaterial,
    glTFMesh,
    glTFMeshPrimitives,
    glTFNode,
    glTFScene
} from "./gltftypes";
import {GLTFAsset} from "./asset";
import {Node} from "./node";
import {Scene} from "./scene";
import {
    AlphaMode,
    BufferOutputType,
    ComponentType,
    DataType,
    ImageOutputType,
    InterpolationMode,
    MeshMode,
    RGBAColor,
    RGBColor,
    TRSMode,
    VertexColorMode
} from "./types";
import {Mesh} from "./mesh";
import {Buffer, BufferAccessorInfo, BufferView} from "./buffer";
import {Vertex} from "./vertex";
import {Material} from "./material";
import {Texture} from "./texture";
import {imageToArrayBuffer, imageToDataURI} from "./imageutils";
import {Animation} from "./animation";

export function addScenes(gltf: glTF, asset: GLTFAsset): void {
    gltf.scene = asset.defaultScene;

    const doingGLB =
        gltf.extras.options.bufferOutputType === BufferOutputType.GLB
        || gltf.extras.options.imageOutputType === ImageOutputType.GLB;
    if (doingGLB) {
        gltf.extras.binChunkBuffer = addBuffer(gltf);
    }

    asset.forEachScene((scene: Scene) => {
        addScene(gltf, scene);
    });

    if (doingGLB) {
        gltf.extras.binChunkBuffer!.finalize();
    }
}

function addScene(gltf: glTF, scene: Scene): void {
    if (!gltf.scenes)
        gltf.scenes = [];

    const gltfScene: glTFScene = {};
    if (scene.name)
        gltfScene.name = scene.name;

    scene.forEachNode((node: Node) => {
        if (!gltfScene.nodes)
            gltfScene.nodes = [];

        const index = addNode(gltf, node);
        gltfScene.nodes.push(index);
    });

    gltf.scenes.push(gltfScene);
}

function addNode(gltf: glTF, node: Node): number {
    if (!gltf.nodes)
        gltf.nodes = [];

    const gltfNode: glTFNode = {};
    if (node.name)
        gltfNode.name = node.name;

    const translation = node.getTranslation();
    if (translation.x !== 0 || translation.y !== 0 || translation.z !== 0)
        gltfNode.translation = translation.toArray();

    const rotation = node.getRotationQuaternion();
    if (rotation.x !== 0 || rotation.y !== 0 || rotation.z !== 0 || rotation.w !== 1)
        gltfNode.rotation = rotation.toArray();

    const scale = node.getScale();
    if (scale.x !== 1 || scale.y !== 1 || scale.z !== 1)
        gltfNode.scale = scale.toArray();

    const addedIndex = gltf.nodes.length;
    gltf.nodes.push(gltfNode);

    if (node.animations && node.animations.length > 0)
    {
        addAnimations(gltf, node.animations, addedIndex);
    }

    if (node.mesh) {
        gltfNode.mesh = addMesh(gltf, node.mesh);
    }

    node.forEachNode((node: Node) => {
        if (!gltfNode.children)
            gltfNode.children = [];

        const index = addNode(gltf, node);
        gltfNode.children.push(index);
    });

    return addedIndex;
}

export function addAnimations(gltf: glTF, animations: Animation[], nodeIndex: number) {

    if (animations.length == 0)
        return;

    const singleGLBBuffer = gltf.extras.options.bufferOutputType === BufferOutputType.GLB;
    let animBuffer: Buffer;
    if (singleGLBBuffer) {
        // animBuffer = gltf.extras.binChunkBuffer!;
        throw "GLB Not Supported Yet!";
    } else
        animBuffer = addBuffer(gltf);

    let timeBufferView = animBuffer.addBufferView(ComponentType.FLOAT, DataType.SCALAR);
    let vec4BufferView: BufferView | undefined;// = animBuffer.addBufferView(ComponentType.FLOAT, DataType.VEC4);
    let vec3BufferView: BufferView | undefined;// = animBuffer.addBufferView(ComponentType.FLOAT, DataType.VEC3);

    if (!gltf.animations || gltf.animations.length == 0) {
        const gltfAnim: glTFAnimation = {
            channels: [],
            samplers: []
        };
        gltf.animations = [gltfAnim];
    }

    let gltfAnim = gltf.animations![0];

    function _completeAnimation(animBufferView: BufferView, interp_type: InterpolationMode, path: TRSMode)
    {
        let timeAccessor = timeBufferView.endAccessor();
        let timeAccessor_idx = addAccessor(gltf, timeBufferView.getIndex(), timeAccessor);

        let animAccessor = animBufferView.endAccessor();
        let animAccessor_idx = addAccessor(gltf, animBufferView.getIndex(), animAccessor);

        // then create samplers (input: times accessor idx, output: values accessor idx)
        let sampler: glTFAnimationSampler = {
            "input": timeAccessor_idx,
            "output": animAccessor_idx,
            "interpolation": interp_type
        };
        // then create channels (sampler: get sampler idx from above)
        let channel: glTFAnimationChannel = {
            "sampler": gltfAnim.samplers.length,
            "target": {
                "node": nodeIndex,
                "path": path
            }
        };

        gltfAnim.samplers.push(sampler);
        gltfAnim.channels.push(channel);
    }

    for (let anim of animations) {

        if (!anim.keyframes || anim.keyframes.length == 0) {
            continue;
        }

        // push to channels and samplers
        let path = anim.path;
        let isVec4 = anim.keyframes![0].value!.length == 4;
        let animBufferView: BufferView;
        if (isVec4) {
            if (!vec4BufferView)
                vec4BufferView = animBuffer.addBufferView(ComponentType.FLOAT, DataType.VEC4);
            animBufferView = vec4BufferView;
        } else {
            if (!vec3BufferView)
                vec3BufferView = animBuffer.addBufferView(ComponentType.FLOAT, DataType.VEC3);
            animBufferView = vec3BufferView;
        }

        // add accessors
        timeBufferView.startAccessor("POSITION"); // POSITION is just a placeholder
        animBufferView.startAccessor("POSITION"); // POSITION is just a placeholder

        let prev_interp_type = anim.keyframes![0].interp_type;
        for (let keyframe of anim.keyframes)
        {
            let interp_type = keyframe.interp_type;
            let isSpline = interp_type === InterpolationMode.CUBICSPLINE;
            if (interp_type != prev_interp_type)
            {
                _completeAnimation(animBufferView, prev_interp_type, path);
                timeBufferView.startAccessor("POSITION"); // POSITION is just a placeholder
                animBufferView.startAccessor("POSITION"); // POSITION is just a placeholder
            }
            let time = keyframe.time;
            let value = keyframe.value;

            if (isSpline)
            {
                // TODO: cubic interp stuff
                // let outTangent = 1;
                // let inTangent = 1;
                let cubic_info = keyframe.extras;
                // let outTangent = cubic_info?.outTangent
                throw "CUBICSPLINE NOT IMPLEMENTED"
            } else {
                timeBufferView.push(time);
                animBufferView.push(value[0]);
                animBufferView.push(value[1]);
                animBufferView.push(value[2]);
                if (isVec4) animBufferView.push(value[3]);
            }


            prev_interp_type = interp_type;
        }
        _completeAnimation(animBufferView, prev_interp_type, path);
    }

    timeBufferView.finalize();
    if (vec4BufferView)
        vec4BufferView.finalize();
    if (vec3BufferView)
        vec3BufferView.finalize();
    if (!singleGLBBuffer)
        animBuffer.finalize();
}

function addMesh(gltf: glTF, mesh: Mesh): number {
    if (!gltf.meshes)
        gltf.meshes = [];

    if (mesh.mode !== MeshMode.TRIANGLES)
        throw "MeshMode other than TRIANGLES not currently supported";

    addMaterials(gltf, mesh.material);

    const gltfMesh: glTFMesh = {
        primitives: [],
    };

    const addedIndex = gltf.meshes.length;
    gltf.meshes.push(gltfMesh);

    const singleGLBBuffer = gltf.extras.options.bufferOutputType === BufferOutputType.GLB;
    let meshBuffer: Buffer;
    if (singleGLBBuffer) {
        meshBuffer = gltf.extras.binChunkBuffer!;
    }
    else {
        meshBuffer = addBuffer(gltf);
    }

    const vertexBufferView = meshBuffer.addBufferView(ComponentType.FLOAT, DataType.VEC3);
    const vertexNormalBufferView = meshBuffer.addBufferView(ComponentType.FLOAT, DataType.VEC3);
    const vertexUVBufferView = meshBuffer.addBufferView(ComponentType.FLOAT, DataType.VEC2);

    let vertexColorBufferView: BufferView | undefined;
    function _ensureColorBufferView() {
        if (vertexColorBufferView)
            return;

        vertexColorBufferView = meshBuffer.addBufferView(ComponentType.UNSIGNED_BYTE, DataType.VEC4);
    }

    function _completeMeshPrimitive(materialIndex: number): glTFMeshPrimitives {
        const vertexBufferAccessorInfo = vertexBufferView.endAccessor();
        const vertexNormalBufferAccessorInfo = vertexNormalBufferView.endAccessor();
        const vertexUVBufferAccessorInfo = vertexUVBufferView.endAccessor();

        const primitive: glTFMeshPrimitives = {
            attributes: {
                POSITION: addAccessor(gltf, vertexBufferView.getIndex(), vertexBufferAccessorInfo),
                NORMAL: addAccessor(gltf, vertexNormalBufferView.getIndex(), vertexNormalBufferAccessorInfo),
                TEXCOORD_0: addAccessor(gltf, vertexUVBufferView.getIndex(), vertexUVBufferAccessorInfo),
            },
            mode: mesh.mode,
        };
        if (materialIndex >= 0) {
            primitive.material = materialIndex;

            // Only add color data if it is per-face/vertex.
            const material = mesh.material[materialIndex];
            if (material.vertexColorMode !== VertexColorMode.NoColors) {
                const vertexColorBufferAccessorInfo = vertexColorBufferView!.endAccessor();
                primitive.attributes["COLOR_0"] =
                    addAccessor(gltf, vertexColorBufferView!.getIndex(), vertexColorBufferAccessorInfo);
            }
        }

        return primitive;
    }

    let lastMaterialIndex: number | null = null;
    mesh.forEachFace((v1: Vertex, v2: Vertex, v3: Vertex, color: RGBColor | RGBAColor | undefined, materialIndex: number) => {
        let currentMaterial: Material | null = null;
        if (materialIndex >= 0)
            currentMaterial = mesh.material[materialIndex];

        // Need to start new accessors
        if (lastMaterialIndex !== materialIndex) {
            // And end the previous ones.
            if (lastMaterialIndex !== null) {
                const primitive = _completeMeshPrimitive(lastMaterialIndex);
                gltfMesh.primitives.push(primitive);
            }

            vertexBufferView.startAccessor("POSITION");
            vertexNormalBufferView.startAccessor("NORMAL");
            vertexUVBufferView.startAccessor("TEXCOORD_0");
            if (currentMaterial && currentMaterial.vertexColorMode !== VertexColorMode.NoColors) {
                _ensureColorBufferView();
                vertexColorBufferView!.startAccessor("COLOR_0");
            }

            lastMaterialIndex = materialIndex;
        }

        // Positions
        vertexBufferView.push(v1.x);
        vertexBufferView.push(v1.y);
        vertexBufferView.push(v1.z);

        vertexBufferView.push(v2.x);
        vertexBufferView.push(v2.y);
        vertexBufferView.push(v2.z);

        vertexBufferView.push(v3.x);
        vertexBufferView.push(v3.y);
        vertexBufferView.push(v3.z);

        // Vertex normals
        vertexNormalBufferView.push(v1.normalX);
        vertexNormalBufferView.push(v1.normalY);
        vertexNormalBufferView.push(v1.normalZ);

        vertexNormalBufferView.push(v2.normalX);
        vertexNormalBufferView.push(v2.normalY);
        vertexNormalBufferView.push(v2.normalZ);

        vertexNormalBufferView.push(v3.normalX);
        vertexNormalBufferView.push(v3.normalY);
        vertexNormalBufferView.push(v3.normalZ);

        // Texture UV coords
        vertexUVBufferView.push(v1.u);
        vertexUVBufferView.push(v1.v);

        vertexUVBufferView.push(v2.u);
        vertexUVBufferView.push(v2.v);

        vertexUVBufferView.push(v3.u);
        vertexUVBufferView.push(v3.v);

        if (currentMaterial) {
            // Vertex colors
            switch (currentMaterial.vertexColorMode) {
                case VertexColorMode.FaceColors:
                    // Just duplicate the face colors 3 times.
                    for (let v = 0; v < 3; v++) {
                        addColorToBufferView(vertexColorBufferView!, color || new RGBColor());
                    }
                    break;

                case VertexColorMode.VertexColors:
                    addColorToBufferView(vertexColorBufferView!, v1.color || new RGBColor());
                    addColorToBufferView(vertexColorBufferView!, v2.color || new RGBColor());
                    addColorToBufferView(vertexColorBufferView!, v3.color || new RGBColor());
                    break;

                // NoColors? We won't have an accessor.
            }
        }
    });

    if (lastMaterialIndex !== null) {
        const primitive = _completeMeshPrimitive(lastMaterialIndex);
        gltfMesh.primitives.push(primitive);
    }

    vertexBufferView.finalize();
    vertexNormalBufferView.finalize();
    vertexUVBufferView.finalize();
    if (vertexColorBufferView)
        vertexColorBufferView.finalize();

    if (!singleGLBBuffer)
        meshBuffer.finalize();

    return addedIndex;
}

function addColorToBufferView(bufferView: BufferView, color: RGBColor | RGBAColor) {
    bufferView.push((color.r * 255) | 0);
    bufferView.push((color.g * 255) | 0);
    bufferView.push((color.b * 255) | 0);
    if ("a" in color) {
        bufferView.push((color.a * 255) | 0);
    }
    else {
        bufferView.push(0xFF);
    }
}

export function addBuffer(gltf: glTF): Buffer {
    return new Buffer(gltf);
}

export function addAccessor(gltf: glTF, bufferViewIndex: number, accessorInfo: BufferAccessorInfo): number {
    if (!gltf.accessors)
        gltf.accessors = [];

    const addedIndex = gltf.accessors.length;

    const componentType = accessorInfo.componentType;
    const accessor: glTFAccessor = {
        bufferView: bufferViewIndex,
        byteOffset: accessorInfo.byteOffset,
        componentType: componentType,
        count: accessorInfo.count,
        type: accessorInfo.type,
        min: accessorInfo.min,
        max: accessorInfo.max,
    };

    if (accessorInfo.normalized) {
        accessor.normalized = true;
    }

    gltf.accessors.push(accessor);

    return addedIndex;
}

function addMaterials(gltf: glTF, materials: Material[]): number[] {
    const indices = [];
    for (const material of materials) {
        indices.push(addMaterial(gltf, material));
    }
    return indices;
}

function addMaterial(gltf: glTF, material: Material): number {
    if (!gltf.materials)
        gltf.materials = [];

    const gltfMaterial: glTFMaterial = {};
    if (material.name)
        gltfMaterial.name = material.name;
    if (material.alphaMode !== AlphaMode.OPAQUE)
        gltfMaterial.alphaMode = material.alphaMode;
    if (material.alphaCutoff !== 0.5)
        gltfMaterial.alphaCutoff = material.alphaCutoff;
    if (material.doubleSided)
        gltfMaterial.doubleSided = true;
    if (material.pbrMetallicRoughness) {
        if (material.pbrMetallicRoughness.baseColorFactor) {
            gltfMaterial.pbrMetallicRoughness = {};
            gltfMaterial.pbrMetallicRoughness.baseColorFactor = material.pbrMetallicRoughness.baseColorFactor;
        }
        if (material.pbrMetallicRoughness.baseColorTexture) {
            if (!gltfMaterial.pbrMetallicRoughness)
                gltfMaterial.pbrMetallicRoughness = {};
            const textureIndex = addTexture(gltf, material.pbrMetallicRoughness.baseColorTexture);
            gltfMaterial.pbrMetallicRoughness.baseColorTexture = { index: textureIndex };
        }
    }

    const addedIndex = gltf.materials.length;
    gltf.materials.push(gltfMaterial);

    return addedIndex;
}

function addTexture(gltf: glTF, texture: Texture): number {
    if (!gltf.textures)
        gltf.textures = [];

    const gltfTexture = {
        sampler: addSampler(gltf, texture),
        source: addImage(gltf, texture.image),
    };

    const addedIndex = gltf.textures.length;
    gltf.textures.push(gltfTexture);

    return addedIndex;
}

function addImage(gltf: glTF, image: HTMLImageElement | HTMLCanvasElement): number {
    if (!gltf.images)
        gltf.images = [];

    for (let i = 0; i < gltf.images.length; i++) {
        if (image === gltf.images[i].extras) {
            return i; // Already had an identical image.
        }
    }

    const gltfImage: glTFImage = {
        extras: image as any, // For duplicate detection
    };
    switch (gltf.extras.options.imageOutputType) {
        case ImageOutputType.GLB:
            const bufferView = gltf.extras.binChunkBuffer!.addBufferView(ComponentType.UNSIGNED_BYTE, DataType.SCALAR);
            bufferView.writeAsync(imageToArrayBuffer(image)).then(() => {
                bufferView.finalize();
            });
            gltfImage.bufferView = bufferView.getIndex();
            gltfImage.mimeType = "image/png";
            break;

        case ImageOutputType.DataURI:
            gltfImage.uri = imageToDataURI(image);
            break;

        default: // ImageOutputType.External
            gltf.extras.promises.push(imageToArrayBuffer(image).then((pngBuffer: ArrayBuffer) => {
                gltfImage.uri = (pngBuffer as any); // Processed later
            }));
            break;
    }

    const addedIndex = gltf.images.length;
    gltf.images.push(gltfImage);

    return addedIndex;
}

function addSampler(gltf: glTF, texture: Texture): number {
    if (!gltf.samplers)
        gltf.samplers = [];

    const gltfSampler = {
        wrapS: texture.wrapS,
        wrapT: texture.wrapT,
    };

    for (let i = 0; i < gltf.samplers.length; i++) {
        if (objectsEqual(gltfSampler, gltf.samplers[i])) {
            return i; // Already had an identical sampler.
        }
    }

    const addedIndex = gltf.samplers.length;
    gltf.samplers.push(gltfSampler);

    return addedIndex;
}

function objectsEqual(obj1: any, obj2: any): boolean {
    return JSON.stringify(obj1) === JSON.stringify(obj2);
}
