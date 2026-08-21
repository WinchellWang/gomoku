FROM nginx:1.27-alpine
WORKDIR /usr/share/nginx/html
COPY index.html ./index.html
COPY about.md ./about.md
COPY manifest.webmanifest ./manifest.webmanifest
COPY styles.css ./styles.css
COPY app.js ./app.js
COPY rapfi-worker.js ./rapfi-worker.js
COPY engine ./engine
COPY assets ./assets
RUN chmod -R a+rX /usr/share/nginx/html
EXPOSE 80
