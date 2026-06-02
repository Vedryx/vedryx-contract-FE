import { PerspectiveCamera } from 'three/src/cameras/PerspectiveCamera.js'
import { AdditiveBlending, LinearFilter } from 'three/src/constants.js'
import { BufferAttribute } from 'three/src/core/BufferAttribute.js'
import { BufferGeometry } from 'three/src/core/BufferGeometry.js'
import { EdgesGeometry } from 'three/src/geometries/EdgesGeometry.js'
import { IcosahedronGeometry } from 'three/src/geometries/IcosahedronGeometry.js'
import { GridHelper } from 'three/src/helpers/GridHelper.js'
import { LineBasicMaterial } from 'three/src/materials/LineBasicMaterial.js'
import { PointsMaterial } from 'three/src/materials/PointsMaterial.js'
import { SpriteMaterial } from 'three/src/materials/SpriteMaterial.js'
import { Color } from 'three/src/math/Color.js'
import { Vector3 } from 'three/src/math/Vector3.js'
import { Group } from 'three/src/objects/Group.js'
import { LineLoop } from 'three/src/objects/LineLoop.js'
import { LineSegments } from 'three/src/objects/LineSegments.js'
import { Points } from 'three/src/objects/Points.js'
import { Sprite } from 'three/src/objects/Sprite.js'
import { WebGLRenderer } from 'three/src/renderers/WebGLRenderer.js'
import { FogExp2 } from 'three/src/scenes/FogExp2.js'
import { Scene } from 'three/src/scenes/Scene.js'
import { CanvasTexture } from 'three/src/textures/CanvasTexture.js'

export const THREE = {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  EdgesGeometry,
  FogExp2,
  GridHelper,
  Group,
  IcosahedronGeometry,
  LinearFilter,
  LineBasicMaterial,
  LineLoop,
  LineSegments,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Scene,
  Sprite,
  SpriteMaterial,
  Vector3,
  WebGLRenderer,
}

export function makeGlowTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const context = canvas.getContext('2d')
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32)
  gradient.addColorStop(0, 'rgba(255,255,255,1)')
  gradient.addColorStop(0.25, 'rgba(180,200,255,0.85)')
  gradient.addColorStop(0.6, 'rgba(109,139,255,0.25)')
  gradient.addColorStop(1, 'rgba(109,139,255,0)')
  context.fillStyle = gradient
  context.fillRect(0, 0, 64, 64)
  const texture = new THREE.CanvasTexture(canvas)
  texture.needsUpdate = true
  return texture
}

export function makeLabelSprite(text) {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  context.font = "600 46px 'Space Grotesk', sans-serif"
  const width = Math.ceil(context.measureText(text).width + 52)
  const height = 98
  canvas.width = width
  canvas.height = height
  context.fillStyle = 'rgba(11,14,24,0.96)'
  roundRect(context, 1, 1, width - 2, height - 2, height / 2)
  context.fill()
  context.lineWidth = 2
  context.strokeStyle = 'rgba(255,255,255,0.28)'
  roundRect(context, 1, 1, width - 2, height - 2, height / 2)
  context.stroke()
  context.fillStyle = '#f4f6ff'
  context.font = "600 46px 'Space Grotesk', sans-serif"
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(text, width / 2, height / 2)
  const texture = new THREE.CanvasTexture(canvas)
  texture.minFilter = THREE.LinearFilter
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, depthTest: false }))
  sprite.renderOrder = 10
  sprite.scale.set(width * 0.026, height * 0.026, 1)
  return sprite
}

export function disposeScene(scene) {
  scene.traverse((object) => {
    object.geometry?.dispose()
    if (Array.isArray(object.material)) {
      object.material.forEach(disposeMaterial)
    } else if (object.material) {
      disposeMaterial(object.material)
    }
  })
}

function roundRect(context, x, y, width, height, radius) {
  const r = Math.min(radius, height / 2, width / 2)
  context.beginPath()
  context.moveTo(x + r, y)
  context.arcTo(x + width, y, x + width, y + height, r)
  context.arcTo(x + width, y + height, x, y + height, r)
  context.arcTo(x, y + height, x, y, r)
  context.arcTo(x, y, x + width, y, r)
  context.closePath()
}

function disposeMaterial(material) {
  Object.values(material).forEach((value) => {
    if (value?.isTexture) value.dispose()
  })
  material.dispose()
}
