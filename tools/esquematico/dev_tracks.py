import sys, json, math
from PIL import Image, ImageDraw
from pdfgeom import load_page
from tracks import build_track_graph
p=load_page(sys.argv[1],0)
g=build_track_graph(p.segs,(40,100,9356,400))
deg=g.degree()
print('edges',len(g.edges),'nodes',len(g.nodes),'crossings',len(g.crossings))
import collections
print(collections.Counter(deg.values()))
s=0.5
im=Image.new('RGB',(int(p.width*s),int(p.height*s)),'white'); d=ImageDraw.Draw(im)
for e in g.edges:
    (x0,y0),(x1,y1)=e['pts']; d.line([(x0*s,y0*s),(x1*s,y1*s)],fill='black',width=1)
for n,k in deg.items():
    x,y=g.nodes[n]
    col={1:'blue',2:None,3:'red'}.get(k,'magenta')
    if col: d.ellipse([x*s-2,y*s-2,x*s+2,y*s+2],outline=col)
for x,y in g.crossings: d.rectangle([x*s-2,y*s-2,x*s+2,y*s+2],outline='green')
pw=im.width//4
out=Image.new('RGB',(pw,im.height*4),'white')
for i in range(4): out.paste(im.crop((i*pw,0,(i+1)*pw,im.height)),(0,i*im.height))
out.save(sys.argv[2])
