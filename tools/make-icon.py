# -*- coding: utf-8 -*-
"""从 build/logo.png（设计稿）生成应用图标。

logo 是带透明通道的竖构图插图（约 647×728）。做法：
  裁到不透明包围盒 → 等比缩放到目标尺寸内 → 居中贴进透明正方形画布。
正方形化而不是裁切，是为了不切掉面具或箱子。

产物：
  build/icon.ico        electron-builder 打 exe / 安装程序用（多尺寸）
  build/icon.png        256 预览
  build/preview-sheet.png  各尺寸对照图，肉眼检小尺寸是否糊成一团
  src/assets/icon.ico   窗口图标（在 asar 内）
  renderer/shell/logo.png  外壳导航栏顶部那张（34px @2x）

注意：logo 是**整个程序**的标识，只出现在外壳（导航栏、exe、安装程序）。
工具页不带图标 —— 见 tools/strip-tool-brand.py。

依赖：Pillow（只在这一步需要；产物已入库，日常构建不用重跑）
"""
import io
import os
import sys

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE = os.path.join(ROOT, 'build', 'logo.png')
SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256]
ICON_SIZES = [16, 24, 32, 48, 64, 128, 256]
MARGIN = 0.03          # 正方形画布上留白比例，免得插图顶到边
SHELL_LOGO_PX = 34     # 外壳导航栏里 logo 的 CSS 尺寸（输出 2 倍图给 HiDPI）


def load_source():
    if not os.path.exists(SOURCE):
        sys.exit('缺少 %s —— 把设计稿放到这里再跑' % SOURCE)
    image = Image.open(SOURCE).convert('RGBA')
    box = image.getchannel('A').getbbox()
    if box:
        image = image.crop(box)
    print('source    %s  裁后 %s' % (os.path.basename(SOURCE), image.size))
    return image


def square_icon(source, size):
    """等比缩放到 size×(1-2*MARGIN)，居中贴进 size×size 的透明画布。"""
    inner = max(1, int(round(size * (1 - 2 * MARGIN))))
    width, height = source.size
    scale = inner / max(width, height)
    target = (max(1, int(round(width * scale))), max(1, int(round(height * scale))))
    resized = source.resize(target, Image.LANCZOS)
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    canvas.paste(resized, ((size - target[0]) // 2, (size - target[1]) // 2), resized)
    return canvas


def build_preview(icons):
    """一行原尺寸 + 一行小尺寸放大 6 倍（最近邻），用来判断 16/24 还认不认得出。"""
    gap = 14
    pad = 16
    zoom = 6
    small = [n for n in (16, 24, 32) if n in icons]

    row1_h = max(icons)
    row2_h = max(small) * zoom
    width = pad * 2 + sum(icons) + gap * (len(icons) - 1)
    width = max(width, pad * 2 + sum(n * zoom for n in small) + gap * (len(small) - 1))
    height = pad * 3 + row1_h + row2_h

    sheet = Image.new('RGBA', (width, height), (235, 238, 242, 255))
    draw = ImageDraw.Draw(sheet)

    x = pad
    for size in icons:
        sheet.paste(icons[size], (x, pad + row1_h - size), icons[size])
        draw.text((x, pad + row1_h + 4), str(size), fill=(70, 80, 95, 255))
        x += size + gap

    x = pad
    y = pad * 2 + row1_h + 14
    for size in small:
        big = icons[size].resize((size * zoom, size * zoom), Image.NEAREST)
        sheet.paste(big, (x, y), big)
        draw.text((x, y + big.size[1] + 4), '%d x%d' % (size, zoom), fill=(70, 80, 95, 255))
        x += big.size[0] + gap

    return sheet


def main():
    source = load_source()
    build_dir = os.path.join(ROOT, 'build')
    os.makedirs(os.path.join(ROOT, 'src', 'assets'), exist_ok=True)

    icons = {n: square_icon(source, n) for n in SIZES}

    ico_path = os.path.join(build_dir, 'icon.ico')
    icons[256].save(ico_path, format='ICO',
                    sizes=[(n, n) for n in ICON_SIZES],
                    append_images=[icons[n] for n in ICON_SIZES if n != 256])
    print('wrote     build/icon.ico  %d bytes' % os.path.getsize(ico_path))

    icons[256].save(os.path.join(build_dir, 'icon.png'))
    build_preview(icons).save(os.path.join(build_dir, 'preview-sheet.png'))

    import shutil
    shutil.copyfile(ico_path, os.path.join(ROOT, 'src', 'assets', 'icon.ico'))
    print('copied    src/assets/icon.ico')

    # 外壳左侧导航栏顶部那张：直接引文件（外壳不做单文件分发）
    shell_dir = os.path.join(ROOT, 'renderer', 'shell')
    os.makedirs(shell_dir, exist_ok=True)
    square_icon(source, SHELL_LOGO_PX * 2).save(os.path.join(shell_dir, 'logo.png'))
    print('wrote     renderer/shell/logo.png')
    print('preview   build/preview-sheet.png')

    with Image.open(ico_path) as check:
        print('ico sizes %s' % sorted(check.info.get('sizes', [])))


if __name__ == '__main__':
    main()
