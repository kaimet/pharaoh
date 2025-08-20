import http.server
import socketserver

PORT = 8000

Handler = http.server.SimpleHTTPRequestHandler

with socketserver.TCPServer(("", PORT), Handler) as httpd:
    print("serving at port", PORT)
    httpd.serve_forever()
    
# This will start the local web server and you can access your HTML file by opening your web browser and navigating to http://localhost:8000/yourfile.html, replacing yourfile.html with the name of your HTML file. Like http://localhost:8000/index.html