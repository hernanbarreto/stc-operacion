import sys, math, json
import pymupdf
from PIL import Image, ImageDraw
from pdfgeom import load_page
from tracks import build_track_graph
pdf=sys.argv[1]; x0,y0,x1,y1=map(float,sys.argv[2:6]); z=float(sys.argv[6]); out=sys.argv[7]
doc=pymupdf.open(pdf); pg=doc[0]
pix=pg.get_pixmap(matrix=pymupdf.Matrix(z,z),clip=pymupdf.Rect(x0,y0,x1,y1))
im=Image.frombytes('RGB',(pix.width,pix.height),pix.samples).convert('RGB')
# fade
im=Image.blend(im,Image.new('RGB',im.size,'white'),0.55)
d=ImageDraw.Draw(im)
p=load_page(pdf,0)
g=build_track_graph(p.segs,(40,100,9356,400))
deg=g.degree()
T=lambda x,y:((x-x0)*z,(y-y0)*z)
for e in g.edges:
    a,b=e['pts']; d.line([T(*a),T(*b)],fill=(0,0,255),width=2)
for n,k in deg.items():
    x,y=g.nodes[n]
    if x0<=x<=x1 and y0<=y<=y1:
        cx,cy=T(x,y); col={1:'blue',2:'gray',3:'red'}.get(k,'magenta')
        d.ellipse([cx-4,cy-4,cx+4,cy+4],outline=col,width=2)
        if k>=4: d.text((cx+5,cy-10),str(k),fill='magenta')
im.save(out)
