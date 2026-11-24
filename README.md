### mohamed-transit-and-logestics
# mohamed-transit-and-logestics

## Local customer dashboard testing

To preview the customer dashboard with an unverified profile during local development, set
`NEXT_PUBLIC_CUSTOMER_VERIFICATION_BYPASS=true` in `.env.local` and restart `npm run dev`.
The dashboard labels this state as a development bypass; it does not change the customer
record or bypass verification enforced by the backend. Remove the setting when finished.
The bypass is only enabled when `NODE_ENV` is `development`.
