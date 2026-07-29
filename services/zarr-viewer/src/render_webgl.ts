const VERTEX_SHADER = `
attribute vec2 a_position;
attribute vec2 a_texCoord;
varying vec2 v_texCoord;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_texCoord = a_texCoord;
}
`;

const FRAGMENT_SHADER = `
precision mediump float;
varying vec2 v_texCoord;
uniform sampler2D u_texture;
void main() {
  gl_FragColor = texture2D(u_texture, v_texCoord);
}
`;

function compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Failed to create shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) ?? "Shader compile failed";
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

function createProgram(gl: WebGLRenderingContext): WebGLProgram {
  const program = gl.createProgram();
  if (!program) throw new Error("Failed to create program");
  const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) ?? "Program link failed";
    gl.deleteProgram(program);
    throw new Error(message);
  }
  return program;
}

export class WebGLPlaneRenderer {
  private readonly gl: WebGLRenderingContext;
  private readonly program: WebGLProgram;
  private readonly texture: WebGLTexture;
  private readonly positionBuffer: WebGLBuffer;
  private readonly texCoordBuffer: WebGLBuffer;
  private readonly positionLocation: number;
  private readonly texCoordLocation: number;
  private readonly textureLocation: WebGLUniformLocation;

  private constructor(gl: WebGLRenderingContext, program: WebGLProgram) {
    this.gl = gl;
    this.program = program;
    const texture = gl.createTexture();
    const positionBuffer = gl.createBuffer();
    const texCoordBuffer = gl.createBuffer();
    if (!texture || !positionBuffer || !texCoordBuffer) {
      throw new Error("Failed to create WebGL buffers");
    }
    this.texture = texture;
    this.positionBuffer = positionBuffer;
    this.texCoordBuffer = texCoordBuffer;

    const positionLocation = gl.getAttribLocation(program, "a_position");
    const texCoordLocation = gl.getAttribLocation(program, "a_texCoord");
    const textureLocation = gl.getUniformLocation(program, "u_texture");
    if (textureLocation === null) throw new Error("Missing u_texture uniform");
    this.positionLocation = positionLocation;
    this.texCoordLocation = texCoordLocation;
    this.textureLocation = textureLocation;

    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW,
    );
    gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([0, 1, 1, 1, 0, 0, 1, 0]),
      gl.STATIC_DRAW,
    );

    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  }

  static tryCreate(canvas: HTMLCanvasElement): WebGLPlaneRenderer | null {
    const gl =
      canvas.getContext("webgl", {
        alpha: false,
        antialias: false,
        depth: false,
        preserveDrawingBuffer: true,
      }) ??
      canvas.getContext("experimental-webgl", {
        alpha: false,
        antialias: false,
        depth: false,
        preserveDrawingBuffer: true,
      });
    if (!(gl instanceof WebGLRenderingContext)) return null;
    try {
      const program = createProgram(gl);
      return new WebGLPlaneRenderer(gl, program);
    } catch {
      return null;
    }
  }

  draw(rgba: Uint8ClampedArray, width: number, height: number): void {
    const gl = this.gl;
    if (width <= 0 || height <= 0) return;

    if (gl.canvas.width !== width || gl.canvas.height !== height) {
      gl.canvas.width = width;
      gl.canvas.height = height;
    }

    gl.viewport(0, 0, width, height);
    gl.useProgram(this.program);

    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      width,
      height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      rgba,
    );

    gl.uniform1i(this.textureLocation, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.enableVertexAttribArray(this.positionLocation);
    gl.vertexAttribPointer(this.positionLocation, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
    gl.enableVertexAttribArray(this.texCoordLocation);
    gl.vertexAttribPointer(this.texCoordLocation, 2, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}

export function webglRendererAvailable(canvas: HTMLCanvasElement): boolean {
  return WebGLPlaneRenderer.tryCreate(canvas) !== null;
}
