# pchednode RPC Viewer

This project is a simple web interface for querying custom RPC servers and viewing pod data.

## Features

- Select between four RPC endpoints
- Sends a JSON-RPC request (`get-pods`) and displays the response
- Designed to be hosted on [Cloudflare Pages](https://pages.cloudflare.com/)
- Future plans:
  - Filter and sort pods by disk space, staked amount, and reliability score

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
