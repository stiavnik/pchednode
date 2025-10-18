# pchednode RPC Viewer

This project is a simple web interface for querying custom RPC servers and viewing pod data.

## Features

- Select between two RPC endpoints
- Sends a JSON-RPC request (`get-pods`) and displays the response
- Designed to be hosted on [Cloudflare Pages](https://pages.cloudflare.com/)
- Future plans:
  - Filter pods by disk space or other metrics
  - Display pod locations on a world map
  - Add visualizations and sorting

## Deployment

To deploy this site:

1. Clone the repo
2. Connect it to Cloudflare Pages
3. Set build settings:
   - Framework: None
   - Build command: *(leave empty)*
   - Output directory: `.`

## License

This project is licensed under the [MIT License](LICENSE).
